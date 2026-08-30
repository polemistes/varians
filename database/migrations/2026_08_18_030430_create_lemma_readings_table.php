<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A reading is either an ad-hoc span directly into one transcription's
     * continuous text (not required to fall inside any existing
     * TranscriptionSegment's boundaries), or a conjecture. Exactly one of
     * the two is set — enforced in the FormRequest, not here, matching this
     * app's existing convention (e.g. TranscriptionSegment's start<end
     * isn't a DB constraint either).
     */
    public function up(): void
    {
        Schema::create('lemma_readings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('lemma_id')->constrained()->cascadeOnDelete();
            $table->foreignId('transcription_id')->nullable()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('start_offset')->nullable();
            $table->unsignedInteger('end_offset')->nullable();
            $table->foreignId('conjecture_id')->nullable()->constrained()->cascadeOnDelete();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('lemma_readings');
    }
};
