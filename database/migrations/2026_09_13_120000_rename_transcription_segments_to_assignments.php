<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The link between a stretch of a transcript's text and a segment of a work
 * is an ASSIGNMENT — the word the whole application uses now (user
 * decision). The model is App\Models\Assignment; this brings the table with
 * it. The index is renamed too, so a later migration dropping it by its
 * column list — which computes the name from the CURRENT table name —
 * finds it.
 *
 * SQLite (≥ 3.26) rewrites the REFERENCES clauses of every table that
 * points here as part of the rename, so nothing else changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::rename('transcription_segments', 'assignments');

        Schema::table('assignments', function (Blueprint $table) {
            $table->renameIndex('transcription_segments_group_id_index', 'assignments_group_id_index');
        });
    }

    public function down(): void
    {
        Schema::table('assignments', function (Blueprint $table) {
            $table->renameIndex('assignments_group_id_index', 'transcription_segments_group_id_index');
        });

        Schema::rename('assignments', 'transcription_segments');
    }
};
