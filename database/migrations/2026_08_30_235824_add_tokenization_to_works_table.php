<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * How this work's text is divided into the tokens collation aligns on —
     * see App\Enums\Tokenization for why this is a per-work choice rather
     * than a hard-coded whitespace split. Existing works keep exactly
     * today's behaviour via the default.
     */
    public function up(): void
    {
        Schema::table('works', function (Blueprint $table) {
            $table->string('tokenization')->default('whitespace')->after('language');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('works', function (Blueprint $table) {
            $table->dropColumn('tokenization');
        });
    }
};
