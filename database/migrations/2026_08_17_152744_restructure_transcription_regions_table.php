<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A region no longer needs a segment as a middleman — it's now a span
     * directly on the parent transcription's own continuous text, fully
     * independent of citation spans (the two annotate the same text for
     * unrelated purposes and don't need to share boundaries).
     */
    public function up(): void
    {
        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->foreignId('transcription_id')->default(0)->after('id')->constrained()->cascadeOnDelete();
            $table->boolean('needs_review')->default(false)->after('height');
        });

        DB::statement('
            UPDATE transcription_regions
            SET transcription_id = (
                SELECT transcription_id FROM transcription_segments
                WHERE transcription_segments.id = transcription_regions.transcription_segment_id
            )
        ');

        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->dropForeign(['transcription_segment_id']);
            $table->dropColumn('transcription_segment_id');
        });
    }

    /**
     * Reverse the migrations.
     *
     * Note: this restores the column but not its data — once a region's
     * transcription has more than one segment there's no single value to
     * put back.
     */
    public function down(): void
    {
        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->foreignId('transcription_segment_id')->nullable()->after('id')->constrained()->nullOnDelete();
            $table->dropForeign(['transcription_id']);
            $table->dropColumn(['transcription_id', 'needs_review']);
        });
    }
};
