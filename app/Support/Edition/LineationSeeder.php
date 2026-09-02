<?php

namespace App\Support\Edition;

use App\Models\CanonicalPassage;
use App\Models\EditionLineBreak;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;

/**
 * Seeds an edition's lineation from the transcription a passage is added
 * from — a one-time convenience copy, taken because for a poetic text the
 * base manuscript's line divisions are the natural starting point. From the
 * moment it's seeded the lineation is the edition's own data, freely
 * rearranged, with no live relationship to any manuscript's layout: the
 * invariant that a transcription's newlines mean nothing to the work stands.
 *
 * Two granularities, mirroring how lineation is stored:
 * - between passages: `EditionPassage.starts_new_line`/`starts_new_paragraph`,
 *   read off the whitespace between consecutive cited spans;
 * - inside a passage: `EditionLineBreak` rows before collation columns,
 *   read off the whitespace between the layer's consecutive readings —
 *   colometry, which lyric drama needs from the start.
 */
class LineationSeeder
{
    /**
     * The between-passage flags for a segment added right after `$previous`
     * in the same add batch: two-or-more newlines between the spans read as
     * a paragraph, one as a line, none as prose flowing on. No previous
     * segment (or one from a different layer, or physically out of order)
     * gives the conservative default — a fresh line.
     *
     * @return array{starts_new_line: bool, starts_new_paragraph: bool}
     */
    public static function interPassageFlags(?TranscriptionSegment $previous, TranscriptionSegment $segment): array
    {
        if (
            $previous === null
            || $previous->transcription_layer_id !== $segment->transcription_layer_id
            || $segment->start_offset < $previous->end_offset
        ) {
            return ['starts_new_line' => true, 'starts_new_paragraph' => false];
        }

        $gap = mb_substr(
            $segment->transcriptionLayer->text,
            $previous->end_offset,
            $segment->start_offset - $previous->end_offset,
        );
        $newlines = mb_substr_count($gap, "\n");

        return [
            'starts_new_line' => $newlines >= 1,
            'starts_new_paragraph' => $newlines >= 2,
        ];
    }

    /**
     * Colometry inside the passage: a newline in the layer's text between
     * two consecutive readings becomes a break before the later reading's
     * column. Gaps that jump between the parts of a discontinuous citation
     * are physical displacement, not whitespace, and seed nothing.
     */
    public static function seedWithinPassage(EditionPassage $editionPassage, TranscriptionLayer $layer): void
    {
        $passage = $editionPassage->canonicalPassage;
        $spans = TranscriptionSegment::where('canonical_passage_id', $passage->id)
            ->where('transcription_layer_id', $layer->id)
            ->get(['start_offset', 'end_offset']);

        $containingSpan = function (LemmaReading $reading) use ($spans): ?int {
            $index = $spans->search(
                fn (TranscriptionSegment $span) => $reading->start_offset >= $span->start_offset
                    && $reading->end_offset <= $span->end_offset
            );

            return $index === false ? null : (int) $index;
        };

        $previous = null;

        foreach (self::layerReadingsInColumnOrder($passage, $layer) as $reading) {
            if ($previous !== null
                && $reading->start_offset > $previous->end_offset
                && $containingSpan($reading) === $containingSpan($previous)) {
                $gap = mb_substr(
                    $layer->text,
                    $previous->end_offset,
                    $reading->start_offset - $previous->end_offset,
                );
                $newlines = mb_substr_count($gap, "\n");

                if ($newlines >= 1) {
                    EditionLineBreak::firstOrCreate(
                        [
                            'edition_id' => $editionPassage->edition_id,
                            'lemma_id' => $reading->lemma_id,
                        ],
                        [
                            'canonical_passage_id' => $passage->id,
                            'kind' => $newlines >= 2 ? 'paragraph' : 'line',
                        ],
                    );
                }
            }

            $previous = $reading;
        }
    }

    /**
     * @return array<int, LemmaReading>
     */
    private static function layerReadingsInColumnOrder(CanonicalPassage $passage, TranscriptionLayer $layer): array
    {
        $positions = Lemma::where('canonical_passage_id', $passage->id)
            ->pluck('position', 'id');

        return LemmaReading::whereIn('lemma_id', $positions->keys())
            ->where('transcription_layer_id', $layer->id)
            ->whereNotNull('start_offset')
            ->get()
            ->sortBy(fn (LemmaReading $reading) => (float) $positions[$reading->lemma_id])
            ->values()
            ->all();
    }
}
