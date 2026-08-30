<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A thin per-edition selection, not an owner of readings: which of a
     * shared Lemma's candidate LemmaReadings this Edition currently prints.
     * `selected_reading_id` is NOT NULL and cascades — a row's mere
     * existence *is* "this edition has picked something for this lemma";
     * there's no separate "in scope but undecided" state, since "no row"
     * already means undecided, and losing the picked reading means losing
     * the pick.
     */
    public function up(): void
    {
        Schema::create('edition_lemmas', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('lemma_id')->constrained()->cascadeOnDelete();
            $table->foreignId('selected_reading_id')->constrained('lemma_readings')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['edition_id', 'lemma_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_lemmas');
    }
};
