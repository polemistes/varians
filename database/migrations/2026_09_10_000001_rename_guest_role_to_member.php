<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Guest" was the default role of every registered account — a name that
 * made sense while only editors could create anything. Now every member
 * creates and owns works, witnesses, editions and conjectures, and the role
 * only says what she may do to OTHER people's material. See App\Enums\Role.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')->where('role', 'guest')->update(['role' => 'member']);

        Schema::table('users', function (Blueprint $table) {
            $table->string('role')->default('member')->change();
        });
    }

    public function down(): void
    {
        DB::table('users')->where('role', 'member')->update(['role' => 'guest']);

        Schema::table('users', function (Blueprint $table) {
            $table->string('role')->default('guest')->change();
        });
    }
};
