<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Bring the citations already recorded onto the invariant every new one now
 * keeps: whole words, and none of the whitespace at their edges.
 *
 * That whitespace is what stood between a citation and the gap beside it,
 * so trimming it is what makes the GRAY GAP visible everywhere — the place
 * an editor can put the caret and type something the citation does not
 * claim. See App\Support\Transcription\CitationBounds.
 *
 * Only whitespace is dropped. A citation is never widened here: a bound
 * sitting inside a word is a real question about what the citation covers,
 * and CitationIntegrity reports it for the editor to settle.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('transcription_layers')->select('id', 'text')->cursor() as $layer) {
            $text = (string) $layer->text;

            $segments = DB::table('transcription_segments')
                ->where('transcription_layer_id', $layer->id)
                ->select('id', 'start_offset', 'end_offset')
                ->get();

            foreach ($segments as $segment) {
                $start = (int) $segment->start_offset;
                $end = (int) $segment->end_offset;

                while ($start < $end && preg_match('/\s/u', mb_substr($text, $start, 1)) === 1) {
                    $start++;
                }

                while ($end > $start && preg_match('/\s/u', mb_substr($text, $end - 1, 1)) === 1) {
                    $end--;
                }

                if ($end > $start && ($start !== (int) $segment->start_offset || $end !== (int) $segment->end_offset)) {
                    DB::table('transcription_segments')
                        ->where('id', $segment->id)
                        ->update(['start_offset' => $start, 'end_offset' => $end]);
                }
            }
        }
    }

    /**
     * Whitespace a citation never should have held is not worth putting
     * back, and the offsets it stood at are not recorded anywhere.
     */
    public function down(): void {}
};
