<?php

use App\Enums\Visibility;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A transcription is public or it is not, and if it is, both of its layers
 * are. Holding `visibility` per layer encoded an assumption that does not
 * hold — that a diplomatic layer is somehow more provisional than the
 * normalized one — when which layer is written first is simply how the editor
 * chooses to work.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Dropped first: the index kept its old name through the table
        // rename, so it would collide with the one added below.
        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->dropIndex('transcriptions_visibility_index');
        });

        Schema::table('transcriptions', function (Blueprint $table) {
            $table->string('visibility')->default(Visibility::Draft->value)->index()->after('name');
        });

        // Published if any layer was: publication was granted at that level,
        // and withdrawing it silently would hide work that is already public.
        DB::table('transcriptions')->update([
            'visibility' => DB::raw(
                "CASE WHEN EXISTS (
                    SELECT 1 FROM transcription_layers l
                    WHERE l.transcription_id = transcriptions.id
                      AND l.visibility = 'published'
                ) THEN 'published' ELSE 'draft' END"
            ),
        ]);

        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->dropColumn('visibility');
        });
    }

    public function down(): void
    {
        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->string('visibility')->default(Visibility::Draft->value)->after('text');
        });

        DB::statement(
            'UPDATE transcription_layers SET visibility = (
                SELECT t.visibility FROM transcriptions t WHERE t.id = transcription_layers.transcription_id
            )'
        );

        Schema::table('transcriptions', function (Blueprint $table) {
            $table->dropIndex(['visibility']);
            $table->dropColumn('visibility');
        });

        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->index('visibility', 'transcriptions_visibility_index');
        });
    }
};
