<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An editor's free-text note on a point in her own edition — see
     * App\Models\EditionComment for what it is for.
     *
     * `lemma_id`/`range_end_lemma_id` narrow a note to one column or a span
     * of them, and are deliberately `nullOnDelete` rather than cascading: if
     * the columns are ever rebuilt the note must survive, degrading to a
     * note on the passage as a whole rather than being destroyed. A
     * scholar's own words are never collateral damage.
     */
    public function up(): void
    {
        Schema::create('edition_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('canonical_passage_id')->constrained()->cascadeOnDelete();
            $table->foreignId('lemma_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('range_end_lemma_id')->nullable()->constrained('lemmas')->nullOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('note');
            $table->timestamps();

            $table->index(['edition_id', 'canonical_passage_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_comments');
    }
};
