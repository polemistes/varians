<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A witness's statement that it *lacks* the columns this reading spans —
     * zero-width, anchored between its neighbouring words, written by
     * PassageAligner::recordOmissions. Distinct from a zero-width
     * `needs_review` remnant (a selected reading a text edit destroyed).
     */
    public function up(): void
    {
        Schema::table('lemma_readings', function (Blueprint $table) {
            $table->boolean('omitted')->default(false)->after('needs_review');
        });
    }

    public function down(): void
    {
        Schema::table('lemma_readings', function (Blueprint $table) {
            $table->dropColumn('omitted');
        });
    }
};
