<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One photograph per page (user decision): a page is one leaf, and one shot
 * of it is what the workbench shows beside the text. Where several existed,
 * the earliest-positioned one stays; the extras go, cascading their feature
 * markers and image alignments.
 */
return new class extends Migration
{
    public function up(): void
    {
        $keep = DB::table('manuscript_images')
            ->selectRaw('manuscript_page_id, min(position) as first_position')
            ->groupBy('manuscript_page_id')
            ->get();

        foreach ($keep as $row) {
            $keeper = DB::table('manuscript_images')
                ->where('manuscript_page_id', $row->manuscript_page_id)
                ->where('position', $row->first_position)
                ->orderBy('id')
                ->first();

            DB::table('manuscript_images')
                ->where('manuscript_page_id', $row->manuscript_page_id)
                ->where('id', '!=', $keeper->id)
                ->delete();
        }

        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->unique('manuscript_page_id');
        });
    }

    public function down(): void
    {
        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->dropUnique(['manuscript_page_id']);
        });
    }
};
