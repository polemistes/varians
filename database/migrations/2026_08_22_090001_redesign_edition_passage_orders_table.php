<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Replaces the pairwise "swap with the neighbor" shape (adjacent-pair
     * only, witness-sourced only) with a range shape: an edition's choice of
     * which source's own internal sequence to follow for a whole span of
     * passages, sourced from *either* a transcription's own physical order
     * (nullable `transcription_id`) *or* a catalogued
     * ConjectureType::Reordering (nullable `conjecture_id`) — mirrors
     * LemmaReading's identical transcription-xor-conjecture duality.
     * Nothing in production data used the old shape (confirmed empty), so
     * this drops and recreates rather than altering column-by-column.
     */
    public function up(): void
    {
        Schema::dropIfExists('edition_passage_orders');

        Schema::create('edition_passage_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('range_start_canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->foreignId('range_end_canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->foreignId('transcription_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('conjecture_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained();
            $table->timestamps();

            $table->unique(['edition_id', 'range_start_canonical_passage_id', 'range_end_canonical_passage_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_passage_orders');

        Schema::create('edition_passage_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->foreignId('move_target_canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->string('move_position');
            $table->foreignId('transcription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained();
            $table->timestamps();

            $table->unique(['edition_id', 'canonical_passage_id', 'move_target_canonical_passage_id']);
        });
    }
};
