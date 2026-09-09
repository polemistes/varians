<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The members an edition's owner has invited to edit it. A grant on an
 * edition carries to the witnesses and conjectures connected to its work —
 * see WorkPolicy::update, where the grant is resolved. `granted_by_id` is
 * attribution only (an administrator may grant on anyone's edition).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edition_editors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('granted_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['edition_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edition_editors');
    }
};
