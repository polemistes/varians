<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The proposed sequence for a ConjectureType::Reordering — a set of
     * passages read in a different internal order among themselves, never
     * moved anywhere. `Conjecture.canonical_passage_id` stays just the
     * set's first passage by citation order (the usual anchor); this table
     * is the authoritative set-and-sequence, one row per passage in the
     * proposal.
     */
    public function up(): void
    {
        Schema::create('conjecture_ordering_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conjecture_id')->constrained()->cascadeOnDelete();
            $table->foreignId('canonical_passage_id')->constrained('canonical_passages')->cascadeOnDelete();
            $table->unsignedInteger('sequence');
            $table->timestamps();

            $table->unique(['conjecture_id', 'canonical_passage_id']);
            $table->unique(['conjecture_id', 'sequence']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('conjecture_ordering_entries');
    }
};
