<?php

namespace App\Support\Transcription;

/**
 * Applies an ordered log of exact text-edit operations to a set of character-offset
 * spans (TranscriptionSegment or TranscriptionRegion rows), keeping every span's
 * boundaries deterministically correct as the underlying text changes — replacing
 * the old diff-based SpanRebaser, which could only infer a single changed region
 * from a before/after string and left anything overlapping it flagged with stale,
 * untouched offsets.
 *
 * An op {start, end, text} means: remove the current text's [start, end) and
 * insert `text` at `start`. Multiple ops passed in one call are applied strictly
 * in order, each against the offsets produced by the previous one — this is what
 * lets several disjoint edits in a single save each transform correctly, unlike
 * SpanRebaser's single-contiguous-region assumption.
 *
 * A pure insertion (start === end) uses boundary "gravity" to resolve the
 * otherwise-ambiguous case of typing exactly at a span's edge: the start boundary
 * has right-gravity (typing there pushes the span forward rather than joining it),
 * the end boundary has left-gravity (typing there extends the span) — this is what
 * makes "insert inside an existing range, it just becomes part of that range" work
 * for the common case of continuing to type right after what you were just editing.
 */
class SpanTransformer
{
    /**
     * @param  list<array{start: int, end: int, needsReview: bool}>  $spans
     * @param  list<array{start: int, end: int, text: string}>  $ops
     * @return list<array{start: int, end: int, needsReview: bool, deleted: bool}>
     */
    public static function transform(array $spans, array $ops): array
    {
        $results = array_map(fn (array $span) => [
            'start' => $span['start'],
            'end' => $span['end'],
            'needsReview' => $span['needsReview'],
            'deleted' => false,
        ], $spans);

        foreach ($ops as $op) {
            $results = array_map(
                fn (array $span) => $span['deleted'] ? $span : self::applyOp($span, $op),
                $results,
            );
        }

        return $results;
    }

    /**
     * The two operations that lift the text of [$start, $end) out and set it
     * down at $target, and the offset it ends up at.
     *
     * Moving is a deletion and an insertion, but it cannot be done as a plain
     * cut and paste: a deletion covering a cited span destroys it (see
     * applyReplace), so the citation would be lost exactly when it is meant to
     * travel. The caller relocates whatever was anchored inside the span
     * explicitly and transforms everything else through these ops — see
     * TranscriptionSegmentController::move.
     *
     * $target is given in the text as it stands now. Removing the span first
     * shifts anything after it, so a destination beyond the span moves back by
     * its length.
     *
     * @return array{ops: list<array{start: int, end: int, text: string}>, destination: int}
     */
    public static function relocation(string $text, int $start, int $end, int $target): array
    {
        $moved = mb_substr($text, $start, $end - $start);
        $destination = $target > $end ? $target - ($end - $start) : $target;

        return [
            'ops' => [
                ['start' => $start, 'end' => $end, 'text' => ''],
                ['start' => $destination, 'end' => $destination, 'text' => $moved],
            ],
            'destination' => $destination,
        ];
    }

    /**
     * The same transformation for single points rather than spans — where a
     * manuscript page begins in this text (TranscriptionPageBreak).
     *
     * A point is not a zero-width span, because the gravity has to be the
     * other way round. `transform()` gives a span's start right-gravity, so
     * typing exactly at a zero-width span pushes it forward; a page break
     * treated that way would mean the first words typed at the top of a page
     * land on the page before it — precisely the case an editor transcribing
     * page by page hits every time she starts a new one. Here an insertion
     * exactly at the break stays after it, so what is typed at the top of a
     * page belongs to that page.
     *
     * A point is never deleted: deleting the text a page held does not
     * abolish the page, it empties it, leaving its break where the deletion
     * began — possibly alongside the next page's break, which is what an
     * empty page looks like.
     *
     * @param  list<int>  $points
     * @param  list<array{start: int, end: int, text: string}>  $ops
     * @return list<int>
     */
    public static function transformPoints(array $points, array $ops): array
    {
        foreach ($ops as $op) {
            $insertedLen = mb_strlen($op['text']);

            $points = array_map(function (int $point) use ($op, $insertedLen) {
                if ($op['start'] === $op['end']) {
                    return $op['start'] < $point ? $point + $insertedLen : $point;
                }

                if ($point <= $op['start']) {
                    return $point;
                }

                if ($point >= $op['end']) {
                    return $point + $insertedLen - ($op['end'] - $op['start']);
                }

                // The break stood inside the replaced stretch: the text that
                // followed it is gone, so the page now starts where the
                // replacement does.
                return $op['start'];
            }, $points);
        }

        return $points;
    }

    /**
     * @param  array{start: int, end: int, needsReview: bool, deleted: bool}  $span
     * @param  array{start: int, end: int, text: string}  $op
     * @return array{start: int, end: int, needsReview: bool, deleted: bool}
     */
    private static function applyOp(array $span, array $op): array
    {
        $insertedLen = mb_strlen($op['text']);

        if ($op['start'] === $op['end']) {
            return self::applyInsertion($span, $op['start'], $insertedLen);
        }

        $delta = $insertedLen - ($op['end'] - $op['start']);

        return self::applyReplace($span, $op['start'], $op['end'], $insertedLen, $delta);
    }

    /**
     * @param  array{start: int, end: int, needsReview: bool, deleted: bool}  $span
     * @return array{start: int, end: int, needsReview: bool, deleted: bool}
     */
    private static function applyInsertion(array $span, int $p, int $insertedLen): array
    {
        if ($p <= $span['start']) {
            $span['start'] += $insertedLen;
            $span['end'] += $insertedLen;

            return $span;
        }

        if ($p <= $span['end']) {
            $span['end'] += $insertedLen;
        }

        return $span;
    }

    /**
     * @param  array{start: int, end: int, needsReview: bool, deleted: bool}  $span
     * @return array{start: int, end: int, needsReview: bool, deleted: bool}
     */
    private static function applyReplace(array $span, int $start, int $end, int $insertedLen, int $delta): array
    {
        if ($span['end'] <= $start) {
            return $span;
        }

        if ($span['start'] >= $end) {
            $span['start'] += $delta;
            $span['end'] += $delta;

            return $span;
        }

        if ($start <= $span['start'] && $end >= $span['end']) {
            if ($insertedLen === 0) {
                $span['deleted'] = true;

                return $span;
            }

            $span['start'] = $start;
            $span['end'] = $start + $insertedLen;
            $span['needsReview'] = true;

            return $span;
        }

        if ($span['start'] <= $start && $end <= $span['end']) {
            $span['end'] += $delta;

            return $span;
        }

        if ($start < $span['start']) {
            $span['start'] = $end + $delta;
            $span['end'] += $delta;
            $span['needsReview'] = true;

            return $span;
        }

        $span['end'] = $start;
        $span['needsReview'] = true;

        return $span;
    }
}
