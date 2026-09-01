<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where each manuscript page begins in a layer's text.
 *
 * Breakpoints rather than spans: a layer's text is the whole document in the
 * physical order it was read, so a page is simply the stretch between one
 * break and the next. One offset per page instead of two means pages cannot
 * overlap or leave gaps by construction, and dividing an imported text is a
 * matter of placing marks in it rather than filling in ranges. Text before the
 * first break belongs to no page yet.
 *
 * Both layers are divided, so the break belongs to a layer, not to the
 * transcription: the two layers have different text and therefore different
 * offsets.
 *
 * This is the fourth set of character offsets into `transcription_layers.text`
 * — after segments, regions and lemma readings — and like them it must be
 * transformed by SpanTransformer whenever that text is edited, or editing a
 * word early in a transcription will silently slide every later page
 * boundary. See TranscriptionTextController.
 *
 * Deliberately not unique on `start_offset`: deleting all of a page's text
 * leaves its break and the next one at the same place, which is an empty page
 * and a legitimate state.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transcription_page_breaks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transcription_layer_id')->constrained()->cascadeOnDelete();
            $table->foreignId('manuscript_page_id')->constrained()->cascadeOnDelete();
            $table->integer('start_offset');
            $table->timestamps();

            // A page begins in one place in any given layer.
            $table->unique(['transcription_layer_id', 'manuscript_page_id']);
            $table->index(['transcription_layer_id', 'start_offset']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transcription_page_breaks');
    }
};
