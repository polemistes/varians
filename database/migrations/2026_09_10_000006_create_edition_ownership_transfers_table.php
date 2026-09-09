<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An offer to hand an edition to another member. Ownership moves only when
 * she accepts; until then the offer stands, and the owner (or an
 * administrator) may withdraw it. One open offer per edition at a time,
 * enforced where offers are made (EditionOwnershipTransferController) —
 * a partial unique index is not portable across the supported databases.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edition_ownership_transfers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('edition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('from_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('to_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('outcome')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['to_user_id', 'resolved_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edition_ownership_transfers');
    }
};
