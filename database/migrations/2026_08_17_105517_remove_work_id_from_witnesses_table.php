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
        Schema::table('witnesses', function (Blueprint $table) {
            $table->dropForeign(['work_id']);
            $table->dropColumn('work_id');
        });
    }

    /**
     * Reverse the migrations.
     *
     * Note: this restores the column but not its data — once a witness is
     * attached to more than one work there's no single value to put back.
     */
    public function down(): void
    {
        Schema::table('witnesses', function (Blueprint $table) {
            $table->foreignId('work_id')->nullable()->after('id')->constrained()->nullOnDelete();
        });
    }
};
