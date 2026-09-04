<?php

use App\Support\Transcription\LayerCorrespondence;
use App\Support\Transcription\WordSpans;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Counterpart spans across the two layers of a transcript become ONE
 * identity: rows carrying the same citation (or the same facsimile box)
 * over the same words share a `group_id`, so mutations act on the pair by
 * link rather than by fragile range-matching — and a healing pass can
 * later fill a missing side by projection whenever the layers are in step.
 *
 * Rows deliberately stay per-layer with per-layer character offsets: each
 * transforms with its own layer's edits through the existing pipeline,
 * which is unambiguous even while the layers are out of step (a shared
 * word-coordinate store is not — a catch-up edit cannot be told from a
 * leading one).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->string('group_id', 36)->nullable()->index();
        });
        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->string('group_id', 36)->nullable()->index();
        });

        // Link existing counterpart rows: for each transcript whose layers
        // are in step, rows citing the same passage (or mapping the same
        // image) over the same WORDS are the same span seen from two sides.
        $layers = DB::table('transcription_layers')->get()->groupBy('transcription_id');

        foreach ($layers as $pair) {
            if ($pair->count() !== 2) {
                continue;
            }

            [$a, $b] = [$pair[0], $pair[1]];

            if (LayerCorrespondence::divergence($a->text, $b->text) !== null) {
                continue;
            }

            $this->linkTable('transcription_segments', 'canonical_passage_id', $a, $b);
            $this->linkTable('transcription_regions', 'manuscript_image_id', $a, $b);
        }

        // Every remaining row is its own (singleton) group.
        foreach (['transcription_segments', 'transcription_regions'] as $table) {
            foreach (DB::table($table)->whereNull('group_id')->pluck('id') as $id) {
                DB::table($table)->where('id', $id)->update(['group_id' => (string) Str::uuid()]);
            }
        }
    }

    private function linkTable(string $table, string $sharedKey, stdClass $a, stdClass $b): void
    {
        $aRows = DB::table($table)->where('transcription_layer_id', $a->id)->whereNull('group_id')->get();
        $bRows = DB::table($table)->where('transcription_layer_id', $b->id)->whereNull('group_id')->get()->keyBy('id');

        foreach ($aRows as $row) {
            $wordRange = WordSpans::toWordRange($a->text, (int) $row->start_offset, (int) $row->end_offset);

            foreach ($bRows as $candidate) {
                if ($candidate->{$sharedKey} !== $row->{$sharedKey}) {
                    continue;
                }

                $candidateRange = WordSpans::toWordRange($b->text, (int) $candidate->start_offset, (int) $candidate->end_offset);

                if ($candidateRange === $wordRange) {
                    $group = (string) Str::uuid();
                    DB::table($table)->where('id', $row->id)->update(['group_id' => $group]);
                    DB::table($table)->where('id', $candidate->id)->update(['group_id' => $group]);
                    $bRows->forget($candidate->id);

                    break;
                }
            }
        }
    }

    public function down(): void
    {
        Schema::table('transcription_segments', function (Blueprint $table) {
            $table->dropColumn('group_id');
        });
        Schema::table('transcription_regions', function (Blueprint $table) {
            $table->dropColumn('group_id');
        });
    }
};
