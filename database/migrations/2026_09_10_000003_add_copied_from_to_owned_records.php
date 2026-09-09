<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where a copy came from, on each of the records a copy of a public edition
 * reproduces — the same provenance TranscriptionLayer already keeps in
 * `copied_from_id`. Nulled when the original goes: the copy is a whole of
 * its own and must not follow it.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['works', 'witnesses', 'editions', 'conjectures'] as $tableName) {
            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                $table->foreignId('copied_from_id')->nullable()->constrained($tableName)->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (['conjectures', 'editions', 'witnesses', 'works'] as $tableName) {
            Schema::table($tableName, function (Blueprint $table) {
                $table->dropConstrainedForeignId('copied_from_id');
            });
        }
    }
};
