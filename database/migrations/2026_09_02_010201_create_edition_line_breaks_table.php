<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A line (or paragraph) break INSIDE a passage, before one of its
     * collation columns — per edition, since colometry (how the lyric parts
     * of a drama divide into lines) is exactly the kind of choice every
     * edition makes differently. Breaks *between* passages live on
     * edition_passages as starts_new_line/starts_new_paragraph.
     *
     * `lemma_id` cascades, deliberately NOT the nullOnDelete of
     * edition_comments: a break with no column means nothing ("degrading"
     * has no content the way a comment's words do). Instead breaks PIN the
     * column structure — PassageAligner::hasEditorialContent and
     * realignLayer both refuse to rebuild columns that carry breaks — so the
     * cascade only ever fires when the editor explicitly removes things.
     */
    public function up(): void
    {
        Schema::create('edition_line_breaks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('canonical_passage_id')->constrained()->cascadeOnDelete();
            $table->foreignId('lemma_id')->constrained()->cascadeOnDelete();
            $table->string('kind')->default('line'); // 'line' | 'paragraph'
            $table->timestamps();

            $table->unique(['edition_id', 'lemma_id']);
            $table->index(['edition_id', 'canonical_passage_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_line_breaks');
    }
};
