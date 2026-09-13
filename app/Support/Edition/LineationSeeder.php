<?php

namespace App\Support\Edition;

use App\Models\Assignment;
use App\Models\EditionLineBreak;
use App\Models\EditionSegment;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\TranscriptionLayer;

/**
 * Seeds an edition's lineation from the transcription a segment is added
 * from — a one-time convenience copy, taken because for a poetic text the
 * base manuscript's line divisions are the natural starting point. From the
 * moment it's seeded the lineation is the edition's own data, freely
 * rearranged, with no live relationship to any manuscript's layout: the
 * invariant that a transcription's newlines mean nothing to the work stands.
 *
 * Two granularities, mirroring how lineation is stored:
 * - between segments: `EditionSegment.starts_new_line`/`starts_new_paragraph`,
 *   read off the whitespace between consecutive assigned spans;
 * - inside a segment: `EditionLineBreak` rows before collation columns,
 *   read off the whitespace between the layer's consecutive readings —
 *   colometry, which lyric drama needs from the start.
 */
class LineationSeeder
{
    /**
     * The between-segment flags for an assignment added right after `$previous`
     * in the same add batch: two-or-more newlines between the spans read as
     * a paragraph, one as a line, none as prose flowing on. No previous
     * assignment (or one from a different layer, or physically out of order)
     * gives the conservative default — a fresh line.
     *
     * The newlines are counted in the whole whitespace neighbourhood of the
     * boundary — trailing whitespace inside the previous span, the gap
     * between the spans, and leading whitespace inside this one — not only
     * the bare gap. A span marked by drag-selecting a full line routinely
     * swallows its own trailing "\n" (the selection runs to the start of
     * the next line), which left the gap empty and silently seeded prose
     * out of verse. Where the newline sits relative to the span boundary is
     * an accident of selection; that it sits between the two texts is not.
     *
     * @return array{starts_new_line: bool, starts_new_paragraph: bool}
     */
    public static function interSegmentFlags(?Assignment $previous, Assignment $assignment): array
    {
        if (
            $previous === null
            || $previous->transcription_layer_id !== $assignment->transcription_layer_id
            || $assignment->start_offset < $previous->end_offset
        ) {
            return ['starts_new_line' => true, 'starts_new_paragraph' => false];
        }

        $text = $assignment->transcriptionLayer->text;
        $previousText = mb_substr($text, $previous->start_offset, $previous->end_offset - $previous->start_offset);
        $assignmentText = mb_substr($text, $assignment->start_offset, $assignment->end_offset - $assignment->start_offset);

        preg_match('/\s+$/u', $previousText, $trailing);
        preg_match('/^\s+/u', $assignmentText, $leading);

        $boundary = ($trailing[0] ?? '')
            .mb_substr($text, $previous->end_offset, $assignment->start_offset - $previous->end_offset)
            .($leading[0] ?? '');
        $newlines = mb_substr_count($boundary, "\n");

        return [
            'starts_new_line' => $newlines >= 1,
            'starts_new_paragraph' => $newlines >= 2,
        ];
    }

    /**
     * Colometry inside the segment: a newline in the layer's text between
     * two consecutive readings becomes a break before the later reading's
     * column. Gaps that jump between the parts of a discontinuous assignment
     * are physical displacement, not whitespace, and seed nothing.
     */
    public static function seedWithinSegment(EditionSegment $editionSegment, TranscriptionLayer $layer): void
    {
        $segment = $editionSegment->segment;
        $spans = Assignment::where('segment_id', $segment->id)
            ->where('transcription_layer_id', $layer->id)
            ->get(['start_offset', 'end_offset']);

        $containingSpan = function (LemmaReading $reading) use ($spans): ?int {
            $index = $spans->search(
                fn (Assignment $span) => $reading->start_offset >= $span->start_offset
                    && $reading->end_offset <= $span->end_offset
            );

            return $index === false ? null : (int) $index;
        };

        $previous = null;

        foreach (self::layerReadingsInColumnOrder($segment, $layer) as $reading) {
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
                            'edition_id' => $editionSegment->edition_id,
                            'lemma_id' => $reading->lemma_id,
                        ],
                        [
                            'segment_id' => $segment->id,
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
    private static function layerReadingsInColumnOrder(Segment $segment, TranscriptionLayer $layer): array
    {
        $positions = Lemma::where('segment_id', $segment->id)
            ->pluck('position', 'id');

        return LemmaReading::whereIn('lemma_id', $positions->keys())
            ->where('transcription_layer_id', $layer->id)
            ->where('omitted', false)
            ->whereNotNull('start_offset')
            ->get()
            ->sortBy(fn (LemmaReading $reading) => (float) $positions[$reading->lemma_id])
            ->values()
            ->all();
    }
}
