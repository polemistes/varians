<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * PARATEXT: what an edition prints beside or among the words of the
     * text without its being text of the work — a marginal note, an inline
     * remark, a speaker's name in a dialogue. See App\Models\EditionParatext.
     *
     * It stands at a point BETWEEN words: before or after one collation
     * column of a segment. `lemma_id` cascades, like an edition's line
     * breaks and unlike its comments: a paratext with no column has no
     * place, and the safety comes from pinning — paratexts count as
     * editorial content, so no collation rebuild can fire the cascade
     * (SegmentAligner::hasEditorialContent and realignLayer). Removing the
     * segment from the edition removes its paratexts, and the page warns.
     *
     * How SPEAKER indications are laid out is one choice for the whole
     * edition (`editions.speaker_display`), not one per indication: a
     * dialogue is set one way throughout.
     */
    public function up(): void
    {
        Schema::create('edition_paratexts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('segment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('lemma_id')->constrained()->cascadeOnDelete();
            $table->string('placement'); // 'before' | 'after' the column
            $table->string('kind'); // App\Enums\ParatextKind
            $table->text('text');
            // The order of several paratexts at one and the same point.
            $table->unsignedInteger('position')->default(1);
            $table->timestamps();

            $table->index(['edition_id', 'segment_id']);
        });

        Schema::table('editions', function (Blueprint $table) {
            $table->string('speaker_display')->default('inline'); // App\Enums\SpeakerDisplay
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('editions', function (Blueprint $table) {
            $table->dropColumn('speaker_display');
        });

        Schema::dropIfExists('edition_paratexts');
    }
};
