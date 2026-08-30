<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('transcription_segments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transcription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('canonical_passage_id')->constrained()->cascadeOnDelete();
            $table->decimal('position', 20, 10)->index();
            $table->longText('text');
            $table->timestamps();

            $table->unique(['transcription_id', 'canonical_passage_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('transcription_segments');
    }
};
