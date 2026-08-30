<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Which transposition proposals a given edition has adopted — a thin
     * per-edition adoption, mirroring EditionLemma, except boolean rather
     * than a selection among competing candidates: a row's mere existence
     * *is* "this edition prints its passages in this moved order." The
     * shared Conjecture(type: transposition) is untouched by adopting or
     * un-adopting it here.
     */
    public function up(): void
    {
        Schema::create('edition_transpositions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conjecture_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['edition_id', 'conjecture_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('edition_transpositions');
    }
};
