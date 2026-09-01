<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A witness may be transcribed more than once — the same manuscript can carry
 * texts that belong to different works, or several kinds of text across the
 * same pages. Each such transcription is named by the editor and consists of
 * exactly two layers, diplomatic and normalized.
 *
 * `witness_id` moves up to the parent, since it is the transcription that is
 * of a witness, not the layer. `visibility` deliberately stays on the layer:
 * a diplomatic layer is often still a draft while its normalized counterpart
 * is published, and EditionController relies on being able to hide one
 * without the other.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transcriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('witness_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->decimal('position', 12, 6)->default(0);
            $table->timestamps();
        });

        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->foreignId('transcription_id')->nullable()->after('id')
                ->constrained()->cascadeOnDelete();
        });

        // One parent per witness, which the old unique index on
        // (witness_id, layer) makes unambiguous: a witness's existing rows are
        // exactly its two layers, so they pair without guesswork.
        foreach (DB::table('transcription_layers')->distinct()->pluck('witness_id') as $witnessId) {
            $transcriptionId = DB::table('transcriptions')->insertGetId([
                'witness_id' => $witnessId,
                'name' => 'Transcription',
                'position' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('transcription_layers')
                ->where('witness_id', $witnessId)
                ->update(['transcription_id' => $transcriptionId]);
        }

        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->dropUnique('transcriptions_witness_id_layer_unique');
            $table->dropConstrainedForeignId('witness_id');
        });

        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->foreignId('transcription_id')->nullable(false)->change();
            $table->unique(['transcription_id', 'layer']);
        });
    }

    public function down(): void
    {
        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->dropUnique(['transcription_id', 'layer']);
            $table->foreignId('witness_id')->nullable()->after('id')
                ->constrained()->cascadeOnDelete();
        });

        foreach (DB::table('transcriptions')->get() as $transcription) {
            DB::table('transcription_layers')
                ->where('transcription_id', $transcription->id)
                ->update(['witness_id' => $transcription->witness_id]);
        }

        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('transcription_id');
            $table->unique(['witness_id', 'layer'], 'transcriptions_witness_id_layer_unique');
        });

        Schema::dropIfExists('transcriptions');
    }
};
