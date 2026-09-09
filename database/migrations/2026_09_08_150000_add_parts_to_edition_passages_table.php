<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An edition may print a line in pieces: adopting a transposition that
     * moves part of a line elsewhere (see ArrangementAdopter) gives that
     * line one row per part, each with its own position in the printed
     * order and its words (`part_text`, matched against the line's runs at
     * render time). A whole line is part 1 with no text, as before.
     */
    public function up(): void
    {
        Schema::table('edition_passages', function (Blueprint $table) {
            $table->dropUnique(['edition_id', 'canonical_passage_id']);
            $table->unsignedSmallInteger('part')->default(1)->after('canonical_passage_id');
            $table->text('part_text')->nullable()->after('position');
            $table->unique(['edition_id', 'canonical_passage_id', 'part']);
        });
    }

    public function down(): void
    {
        Schema::table('edition_passages', function (Blueprint $table) {
            $table->dropUnique(['edition_id', 'canonical_passage_id', 'part']);
            $table->dropColumn(['part', 'part_text']);
            $table->unique(['edition_id', 'canonical_passage_id']);
        });
    }
};
