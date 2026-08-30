<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    /**
     * Run the migrations.
     *
     * The fixed diplomatic/normalized distinction is replaced by free-form
     * tags (see create_tags_table) — the app no longer prescribes how many
     * levels of normalization a witness's transcriptions are divided into.
     */
    public function up(): void
    {
        Schema::table('transcriptions', function (Blueprint $table) {
            $table->dropIndex(['type']);
            $table->dropColumn('type');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcriptions', function (Blueprint $table) {
            $table->string('type')->default('diplomatic')->index();
        });
    }
};
