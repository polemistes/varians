<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Most conjectures aren't the current editor's own idea — they're
     * recording one a scholar proposed long ago. `proposed_by` is that
     * historical proposer (free text — "Bentley", "Wolf, 1795"), kept
     * separate from `user_id`, which is attribution for who entered this
     * record into Varians, not who thought of it.
     *
     * A conjecture isn't always a straight substitution — see
     * App\Enums\ConjectureType:
     * - `extent` is a free-text description of how much is believed
     *   missing, only meaningful for a lacuna.
     * - `supplements_conjecture_id` (self-referencing) is set only on a
     *   Supplement, pointing at the Lacuna it proposes to fill — several
     *   supplements, credited to different proposers, can target the same
     *   lacuna.
     * - `transposition_range_end_canonical_passage_id`,
     *   `move_target_canonical_passage_id`, and `move_position` are only
     *   meaningful for a Transposition: `canonical_passage_id` (through
     *   `transposition_range_end_canonical_passage_id`, inclusive, if moving
     *   more than one passage) is the range being moved, relocated
     *   'before'/'after' the target — an edition-ordering proposal, not a
     *   word-level one.
     */
    public function up(): void
    {
        Schema::create('conjectures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('canonical_passage_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('type')->default('substitution');
            $table->string('text')->nullable();
            $table->string('extent')->nullable();
            $table->foreignId('supplements_conjecture_id')->nullable()->constrained('conjectures')->cascadeOnDelete();
            $table->foreignId('transposition_range_end_canonical_passage_id')->nullable()->constrained('canonical_passages')->cascadeOnDelete();
            $table->foreignId('move_target_canonical_passage_id')->nullable()->constrained('canonical_passages')->cascadeOnDelete();
            $table->string('move_position')->nullable();
            $table->string('proposed_by')->nullable();
            $table->text('bibliography')->nullable();
            $table->text('note')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('conjectures');
    }
};
