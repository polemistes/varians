<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One page division per transcription, not one per layer.
 *
 * A page holds a stretch of the manuscript, and both layers transcribe that
 * same stretch — so where a page begins is a fact about the transcription, not
 * about either text. Held per layer, the two divisions were free to drift
 * apart, and nothing said which was right.
 *
 * The coordinate becomes the **line**, because it is the only one the two
 * layers share: their character offsets differ (the diplomatic layer carries
 * markup the normalized one does not), while a line of the transcription is a
 * line of the manuscript in both. A page begins at the start of a line, since
 * a manuscript line does not span two pages.
 *
 * Where both layers had placed the same page, the earlier row wins; they
 * should agree, and if they did not, one of them was already wrong.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transcription_page_breaks_new', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transcription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('manuscript_page_id')->constrained()->cascadeOnDelete();
            $table->integer('start_line');
            $table->timestamps();

            $table->unique(['transcription_id', 'manuscript_page_id']);
            $table->index(['transcription_id', 'start_line']);
        });

        $seen = [];

        foreach (DB::table('transcription_page_breaks')->orderBy('id')->get() as $break) {
            $layer = DB::table('transcription_layers')
                ->where('id', $break->transcription_layer_id)
                ->first(['id', 'transcription_id', 'text']);

            if (! $layer instanceof stdClass) {
                continue;
            }

            $key = $layer->transcription_id.':'.$break->manuscript_page_id;

            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;

            DB::table('transcription_page_breaks_new')->insert([
                'transcription_id' => $layer->transcription_id,
                'manuscript_page_id' => $break->manuscript_page_id,
                'start_line' => mb_substr_count(mb_substr($layer->text, 0, $break->start_offset), "\n"),
                'created_at' => $break->created_at,
                'updated_at' => $break->updated_at,
            ]);
        }

        Schema::drop('transcription_page_breaks');
        Schema::rename('transcription_page_breaks_new', 'transcription_page_breaks');
    }

    public function down(): void
    {
        Schema::create('transcription_page_breaks_old', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transcription_layer_id')->constrained()->cascadeOnDelete();
            $table->foreignId('manuscript_page_id')->constrained()->cascadeOnDelete();
            $table->integer('start_offset');
            $table->timestamps();

            $table->unique(['transcription_layer_id', 'manuscript_page_id']);
            $table->index(['transcription_layer_id', 'start_offset']);
        });

        foreach (DB::table('transcription_page_breaks')->orderBy('id')->get() as $break) {
            foreach (DB::table('transcription_layers')->where('transcription_id', $break->transcription_id)->get() as $layer) {
                $lines = explode("\n", $layer->text);
                $offset = 0;

                for ($index = 0; $index < $break->start_line && $index < count($lines); $index++) {
                    $offset += mb_strlen($lines[$index]) + 1;
                }

                DB::table('transcription_page_breaks_old')->insert([
                    'transcription_layer_id' => $layer->id,
                    'manuscript_page_id' => $break->manuscript_page_id,
                    'start_offset' => $offset,
                    'created_at' => $break->created_at,
                    'updated_at' => $break->updated_at,
                ]);
            }
        }

        Schema::drop('transcription_page_breaks');
        Schema::rename('transcription_page_breaks_old', 'transcription_page_breaks');
    }
};
