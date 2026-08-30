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
        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->unsignedInteger('start_offset')->after('text');
            $table->unsignedInteger('end_offset')->after('start_offset');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->dropColumn(['start_offset', 'end_offset']);
        });
    }
};
