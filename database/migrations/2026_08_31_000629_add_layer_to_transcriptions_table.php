<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which of a witness's two layers a transcription is — see
     * App\Enums\TranscriptionLayer, including why this deliberately reverses
     * the earlier removal of a `type` column.
     *
     * Existing rows default to `normalized`, which exactly preserves today's
     * behaviour: before this column every transcription was collated, and
     * normalized is the layer that collates. An editor demotes the genuinely
     * diplomatic ones afterward.
     */
    public function up(): void
    {
        Schema::table('transcriptions', function (Blueprint $table) {
            $table->string('layer')->default('normalized')->index()->after('forked_from_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcriptions', function (Blueprint $table) {
            $table->dropColumn('layer');
        });
    }
};
