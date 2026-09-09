<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Set by CitationIntegrity::snap after every save, and cleared by it
     * again: the span begins or ends inside a word with no neighbouring
     * citation, or overlaps one — it has slipped off its words. Separate
     * from `needs_review` (the editor's own confirmation flag) because this
     * one is derived from the text and must come and go by itself.
     */
    public function up(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->boolean('boundary_review')->default(false)->after('needs_review');
        });
    }

    public function down(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->dropColumn('boundary_review');
        });
    }
};
