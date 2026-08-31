<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A witness-sourced LemmaReading's offsets index into its transcription's
     * text, exactly like TranscriptionSegment's and TranscriptionRegion's do,
     * so an edit to that text can partially clobber the span a reading was
     * collated from. Mirrors the `needs_review` flag those two already carry:
     * the reading survives with transformed offsets, flagged for a human to
     * re-confirm rather than silently reporting different words than the
     * editor collated. See TranscriptionTextController::applyReadings.
     */
    public function up(): void
    {
        Schema::table('lemma_readings', function (Blueprint $table) {
            $table->boolean('needs_review')->default(false);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('lemma_readings', function (Blueprint $table) {
            $table->dropColumn('needs_review');
        });
    }
};
