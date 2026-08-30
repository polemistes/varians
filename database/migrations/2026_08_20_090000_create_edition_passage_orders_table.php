<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A thin per-edition selection of which witness's own physical order
     * two passages should follow — mirrors EditionLemma (a row's mere
     * existence *is* the decision), never EditionTransposition/Conjecture:
     * this isn't a reusable scholarly claim, it's this edition's own
     * bookkeeping about which manuscript it chose to follow, so it needs no
     * `proposed_by` and no separate "catalogued vs adopted" layer.
     */
    public function up(): void
    {
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

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_passage_orders');
    }
};
