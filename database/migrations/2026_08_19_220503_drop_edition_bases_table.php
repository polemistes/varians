<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Superseded by edition_passages — an edition's base transcription is
     * now per-passage (edition_passages.transcription_id), not a range.
     */
    public function up(): void
    {
        Schema::dropIfExists('edition_bases');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Not reconstructed — edition_bases is retired, not paused.
    }
};
