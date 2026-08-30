<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Which transcription's own wording flows as the continuous text for a
     * range of an edition — a display choice only. Structure (Lemma /
     * LemmaReading) never anchors to a base, so reassigning one never
     * orphans anything recorded against the old one.
     */
    public function up(): void
    {
        Schema::create('edition_bases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('transcription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('from_canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->foreignId('to_canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_bases');
    }
};
