<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Fork" came from a model where a witness held one transcription per layer,
 * so filling the empty slot beside an existing one was the only way to get a
 * second. What the operation actually does is copy a layer's text — and, when
 * it stays inside the same transcription, its mappings — so it is named for
 * that.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->renameColumn('forked_from_id', 'copied_from_id');
        });
    }

    public function down(): void
    {
        Schema::table('transcription_layers', function (Blueprint $table) {
            $table->renameColumn('copied_from_id', 'forked_from_id');
        });
    }
};
