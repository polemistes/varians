<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which face renders the app's serif (Greek-bearing) text for this user —
 * a reading preference, chosen on the profile page. Values are the
 * App\Enums\GreekFont cases; the default matches the app-wide default in
 * resources/css/app.css.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('greek_font')->default('eb-garamond');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('greek_font');
        });
    }
};
