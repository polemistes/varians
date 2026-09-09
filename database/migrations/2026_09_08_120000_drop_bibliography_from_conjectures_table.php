<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A conjecture's literature is now structured citations of the common
     * bibliography (BibliographyReference); the free-text field beside them
     * would only invite two spellings of one work. Nothing entered in it
     * needed keeping (user decision), so it goes without conversion.
     */
    public function up(): void
    {
        Schema::table('conjectures', function (Blueprint $table) {
            $table->dropColumn('bibliography');
        });
    }

    public function down(): void
    {
        Schema::table('conjectures', function (Blueprint $table) {
            $table->text('bibliography')->nullable();
        });
    }
};
