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
     * The defaults are for SQLite, not for the data: older versions refuse
     * `ALTER TABLE ... ADD COLUMN ... NOT NULL` outright unless one is given.
     * Recent SQLite allows it when the table is empty, which is why this ran
     * in development and failed on the server.
     */
    public function up(): void
    {
        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->unsignedInteger('start_offset')->default(0)->after('text');
            $table->unsignedInteger('end_offset')->default(0)->after('start_offset');
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
