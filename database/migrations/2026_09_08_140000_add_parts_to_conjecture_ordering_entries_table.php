<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A reordering may divide a passage: the editor cut part of a line and
     * pasted it elsewhere, exactly as a witness's citation of a line can
     * stand in two places. One entry per PIECE now — `part` numbers the
     * pieces of one passage in the passage's own (content) order, `text`
     * is the piece's words as the edition read them when the arrangement
     * was registered, so the apparatus can quote the displaced fragment
     * verbatim, the way it quotes a witness's. Whole passages keep part 1.
     */
    public function up(): void
    {
        Schema::table('conjecture_ordering_entries', function (Blueprint $table) {
            $table->dropUnique(['conjecture_id', 'canonical_passage_id']);
            $table->unsignedSmallInteger('part')->default(1)->after('canonical_passage_id');
            $table->text('text')->nullable()->after('sequence');
            $table->unique(['conjecture_id', 'canonical_passage_id', 'part']);
        });
    }

    public function down(): void
    {
        Schema::table('conjecture_ordering_entries', function (Blueprint $table) {
            $table->dropUnique(['conjecture_id', 'canonical_passage_id', 'part']);
            $table->dropColumn(['part', 'text']);
            $table->unique(['conjecture_id', 'canonical_passage_id']);
        });
    }
};
