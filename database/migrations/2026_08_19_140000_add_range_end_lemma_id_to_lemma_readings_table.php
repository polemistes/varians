<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A reading with `range_end_lemma_id` set claims every lemma from its
     * own `lemma_id` (the range's start) through this one (inclusive), not
     * just its own column — used both for an editor's multi-word conjecture
     * and for a witness's own reading when PassageAligner detects it
     * doesn't decompose 1-for-1 against the existing columns (e.g. one
     * witness's "τοσουτοι" against another's "το δε ειναι"). Purely
     * additive: the lemmas in between keep their own independent identity
     * and readings from other witnesses/editions — nothing is merged.
     */
    public function up(): void
    {
        Schema::table('lemma_readings', function (Blueprint $table) {
            $table->foreignId('range_end_lemma_id')->nullable()->after('conjecture_id')
                ->constrained('lemmas')->cascadeOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('lemma_readings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('range_end_lemma_id');
        });
    }
};
