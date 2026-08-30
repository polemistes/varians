<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->boolean('starts_new_paragraph')->default(false)->after('text');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->dropColumn('starts_new_paragraph');
        });
    }
};
