<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A conjecture is a draft until an edition of its work is published, which
 * publishes every conjecture recorded against the work along with it (and
 * unpublishing takes them back). Existing conjectures on a work that
 * already has a published edition are published so nothing readers could
 * see yesterday disappears today.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('conjectures', function (Blueprint $table) {
            $table->string('visibility')->default('draft')->index();
        });

        $publishedWorkIds = DB::table('editions')->where('visibility', 'published')->pluck('work_id');

        DB::table('conjectures')
            ->whereIn('canonical_passage_id', DB::table('canonical_passages')->whereIn('work_id', $publishedWorkIds)->select('id'))
            ->update(['visibility' => 'published']);
    }

    public function down(): void
    {
        Schema::table('conjectures', function (Blueprint $table) {
            $table->dropColumn('visibility');
        });
    }
};
