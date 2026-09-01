<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A manuscript's pages, as their own thing rather than as a property of the
 * photographs of them.
 *
 * Until now a page *was* an image: `manuscript_images.path` is NOT NULL, so a
 * page nobody had photographed could not be recorded at all. But a
 * transcription is often made from something other than images — a printed
 * facsimile, a microfilm, the manuscript itself — and its text still has to be
 * divided onto pages. Images become optional photographs attached to a page
 * that exists whether or not any were taken.
 *
 * `folio_label` moves with it: the label names the page, not the photograph.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('manuscript_pages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('manuscript_id')->constrained()->cascadeOnDelete();
            $table->string('label');
            $table->decimal('position', 12, 6);
            $table->timestamps();

            $table->index('position');
        });

        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->foreignId('manuscript_page_id')->nullable()->after('manuscript_id')
                ->constrained()->cascadeOnDelete();
        });

        // Every existing image is a photograph of a page, so each becomes one,
        // keeping its own label and position.
        foreach (DB::table('manuscript_images')->orderBy('position')->get() as $image) {
            $pageId = DB::table('manuscript_pages')->insertGetId([
                'manuscript_id' => $image->manuscript_id,
                'label' => $image->folio_label,
                'position' => $image->position,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('manuscript_images')->where('id', $image->id)
                ->update(['manuscript_page_id' => $pageId]);
        }

        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->foreignId('manuscript_page_id')->nullable(false)->change();
            $table->dropColumn('folio_label');
        });
    }

    public function down(): void
    {
        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->string('folio_label')->default('')->after('manuscript_id');
        });

        DB::statement(
            'UPDATE manuscript_images SET folio_label = (
                SELECT p.label FROM manuscript_pages p WHERE p.id = manuscript_images.manuscript_page_id
            )'
        );

        Schema::table('manuscript_images', function (Blueprint $table) {
            $table->dropConstrainedForeignId('manuscript_page_id');
        });

        Schema::dropIfExists('manuscript_pages');
    }
};
