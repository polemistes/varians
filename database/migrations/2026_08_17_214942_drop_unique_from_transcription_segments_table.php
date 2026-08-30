<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A leftover from the pre-redesign schema, where a segment owned its own
     * text and one canonical passage could only appear once per transcription.
     * Segments are now arbitrary offset spans — nothing stops (or should stop)
     * the same passage being cited by two separate spans in one transcription.
     */
    public function up(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->dropUnique(['transcription_id', 'canonical_passage_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->unique(['transcription_id', 'canonical_passage_id']);
        });
    }
};
