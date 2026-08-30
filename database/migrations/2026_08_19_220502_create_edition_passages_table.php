<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Records edition scope, order, and per-passage source in one place —
     * a passage is "in" an edition iff it has a row here. `transcription_id`
     * is nullable only for a whole-line lacuna (no manuscript witness at
     * all); every other row names the transcription its segment was added
     * from, which doubles as "the base" for rendering that passage.
     * `position` is the order the editor built the edition in (the
     * manuscript's own physical order for a bulk "base a range" add), not
     * citation order — see App\Support\Edition\PassageAdder.
     */
    public function up(): void
    {
        Schema::create('edition_passages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('canonical_passage_id')->constrained()->cascadeOnDelete();
            $table->foreignId('transcription_id')->nullable()->constrained()->cascadeOnDelete();
            $table->decimal('position', 20, 10);
            $table->timestamps();

            $table->unique(['edition_id', 'canonical_passage_id']);
            $table->index(['edition_id', 'position']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_passages');
    }
};
