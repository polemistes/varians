<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The common bibliography and its citations — see App\Models\BibliographyItem
     * and App\Models\BibliographyReference.
     *
     * An item is one biblatex entry: its `@type`, its citation key and every
     * field it carries, kept exactly as biblatex writes them so the list can
     * round-trip to a .bib file. `label` is derived (author–year) and stored
     * for sorting and search.
     *
     * A reference is one citation of an item by exactly one of two things:
     * a conjecture (edition-independent, like the conjecture), or a passage
     * of one edition — keyed like EditionComment, by edition and canonical
     * passage rather than through EditionPassage, so removing and re-adding
     * a passage does not destroy its literature. Cascades follow the target;
     * an item is never deleted while anything cites it (the FK restricts).
     */
    public function up(): void
    {
        Schema::create('bibliography_items', function (Blueprint $table) {
            $table->id();
            $table->string('entry_type', 40);
            $table->string('citation_key', 120)->unique();
            $table->json('fields');
            $table->string('label');
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();

            $table->index('label');
        });

        Schema::create('bibliography_references', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bibliography_item_id')->constrained()->restrictOnDelete();
            $table->foreignId('conjecture_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('edition_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('canonical_passage_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('prenote')->nullable();
            $table->string('postnote')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->index(['edition_id', 'canonical_passage_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bibliography_references');
        Schema::dropIfExists('bibliography_items');
    }
};
