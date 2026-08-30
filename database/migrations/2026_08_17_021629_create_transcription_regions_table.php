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
        Schema::create('transcription_regions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transcription_segment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('manuscript_image_id')->constrained()->cascadeOnDelete();
            $table->string('text');
            $table->decimal('position', 20, 10)->index();
            $table->decimal('x', 8, 6);
            $table->decimal('y', 8, 6);
            $table->decimal('width', 8, 6);
            $table->decimal('height', 8, 6);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('transcription_regions');
    }
};
