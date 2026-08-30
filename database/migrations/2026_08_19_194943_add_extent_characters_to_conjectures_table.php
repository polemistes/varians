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
        Schema::table('conjectures', function (Blueprint $table) {
            $table->unsignedInteger('extent_characters')->nullable()->after('extent');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('conjectures', function (Blueprint $table) {
            $table->dropColumn('extent_characters');
        });
    }
};
