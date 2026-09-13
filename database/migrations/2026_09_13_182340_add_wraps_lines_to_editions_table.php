<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Whether the edition's printed lines wrap to the width of the text
     * box (the default) or run on, the box scrolling sideways — the
     * editor's choice for her edition, since a verse line broken by the
     * window's width reads as a break she never made. See Editions/Show.vue.
     */
    public function up(): void
    {
        Schema::table('editions', function (Blueprint $table) {
            $table->boolean('wraps_lines')->default(true);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('editions', function (Blueprint $table) {
            $table->dropColumn('wraps_lines');
        });
    }
};
