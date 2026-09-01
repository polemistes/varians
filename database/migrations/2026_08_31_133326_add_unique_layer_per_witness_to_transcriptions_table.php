<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A witness has at most one transcription per layer — two slots, no more.
     *
     * Filtering collation to the normalized layer was not enough on its own:
     * nothing stopped a witness having *two* normalized transcriptions (a
     * same-witness fork produces one, since it inherits the source's layer),
     * and both were then collated, so the manuscript appeared in its own
     * apparatus disagreeing with itself. A uniqueness constraint makes that
     * impossible rather than merely discouraged, and settles the question the
     * code otherwise could not answer: which normalized transcription is
     * *the* one for this witness.
     *
     * One slot per layer is enough even for a manuscript containing several
     * works, since a transcription has no work_id — its text is continuous and
     * its citations point into whichever works it covers.
     */
    public function up(): void
    {
        Schema::table('transcriptions', function (Blueprint $table) {
            $table->unique(['witness_id', 'layer']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcriptions', function (Blueprint $table) {
            $table->dropUnique(['witness_id', 'layer']);
        });
    }
};
