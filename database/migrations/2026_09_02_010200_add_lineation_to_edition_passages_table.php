<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Lineation is the edition's own display vocabulary — a manuscript's
     * physical line breaks mean nothing to the work, and two editions of one
     * work may lay the same passages out entirely differently (verse, prose
     * paragraphs, or a mixture). `starts_new_line` defaults to true because
     * one-passage-per-line is exactly how every existing edition already
     * renders; prose flow is opting *out* per passage.
     */
    public function up(): void
    {
        Schema::table('edition_passages', function (Blueprint $table) {
            $table->boolean('starts_new_line')->default(true);
            $table->boolean('starts_new_paragraph')->default(false);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('edition_passages', function (Blueprint $table) {
            $table->dropColumn(['starts_new_line', 'starts_new_paragraph']);
        });
    }
};
