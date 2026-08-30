<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A lemma is a word/phrase slot within one canonical passage, shared by
     * every edition of the work — collation (what the variants are and
     * where) is edition-independent scholarship; only which candidate an
     * edition prints belongs to the edition (see edition_lemmas).
     */
    public function up(): void
    {
        Schema::create('lemmas', function (Blueprint $table) {
            $table->id();
            $table->foreignId('canonical_passage_id')->constrained()->cascadeOnDelete();
            $table->decimal('position', 20, 10)->index();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('lemmas');
    }
};
