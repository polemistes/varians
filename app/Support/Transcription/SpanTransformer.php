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
 *
 * An op may carry a `cut_id`, pairing one pure deletion (the cut) with one pure
 * insertion of the same text (its paste) later in the log. For every other span
 * the pair is an ordinary delete + insert; a span WHOLLY inside the cut range is
 * carried: it rides along and reappears at the paste, offsets shifted verbatim,
 * unflagged — a cut-and-paste moves the words, and what is anchored to those
 * words is not changed by them sitting somewhere else (the same semantics the
 * old single-click relocation had). A cut whose paste never arrives in this log
 * (the pair was split across saves) degrades to a plain deletion — the span
 * collapses to a tombstone rather than being destroyed, see below.
 *
 * A span the ops destroy is not frozen but collapses to a zero-width span at
 * the point of destruction, flagged, and keeps transforming through later ops —
 * so the caller can keep the row as a tombstone at the right final offset
 * rather than deleting it. `deleted` reports that the destruction happened;
 * what to do about it stays the caller's decision.
 *
 * @phpstan-type WorkingSpan array{start: int, end: int, needsReview: bool, deleted: bool, carried: array{cut_id: string, rel_start: int, rel_end: int}|null}
 */
class SpanTransformer
{
    /**
     * @param  list<array{start: int, end: int, needsReview: bool}>  $spans
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null}>  $ops
     * @return list<array{start: int, end: int, needsReview: bool, deleted: bool}>
     */
    public static function transform(array $spans, array $ops): array
    {
        $results = array_map(fn (array $span) => [
            'start' => $span['start'],
            'end' => $span['end'],
            'needsReview' => $span['needsReview'],
            'deleted' => false,
            'carried' => null,
        ], $spans);

        foreach ($ops as $op) {
            $cutId = $op['cut_id'] ?? null;
            $isCut = $cutId !== null && $op['text'] === '' && $op['end'] > $op['start'];
            $isPaste = $cutId !== null && $op['text'] !== '' && $op['start'] === $op['end'];

            $results = array_map(function (array $span) use ($op, $cutId, $isCut, $isPaste) {
                if ($span['carried'] !== null) {
                    if ($isPaste && $span['carried']['cut_id'] === $cutId) {
                        $span['start'] = $op['start'] + $span['carried']['rel_start'];
                        $span['end'] = $op['start'] + $span['carried']['rel_end'];
                        $span['carried'] = null;

                        return $span;
                    }

                    // The span itself is in the clipboard; only its fallback
                    // tombstone position rides through intermediate ops, so
                    // positional effects apply but destruction flags don't.
                    $flags = [$span['needsReview'], $span['deleted']];
                    $span = self::applyOp($span, $op, $isPaste);
                    [$span['needsReview'], $span['deleted']] = $flags;

                    return $span;
                }

                if ($isCut && $span['start'] >= $op['start'] && $span['end'] <= $op['end']) {
                    $span['carried'] = [
                        'cut_id' => $cutId,
                        'rel_start' => $span['start'] - $op['start'],
                        'rel_end' => $span['end'] - $op['start'],
                    ];
                    // Where the span tombstones if the paste never comes:
                    // the cut point, kept transforming like any other offset.
                    $span['start'] = $op['start'];
                    $span['end'] = $op['start'];

                    return $span;
                }

                return self::applyOp($span, $op, $isPaste);
            }, $results);
        }

        return array_map(function (array $span) {
            if ($span['carried'] !== null) {
                $span['deleted'] = true;
                $span['needsReview'] = true;
            }

            unset($span['carried']);

            return $span;
        }, $results);
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
     * @param  WorkingSpan  $span
     * @param  array{start: int, end: int, text: string}  $op
     * @return WorkingSpan
     */
    private static function applyOp(array $span, array $op, bool $isRelocationPaste = false): array
    {
        $insertedLen = mb_strlen($op['text']);

        if ($op['start'] === $op['end']) {
            return self::applyInsertion($span, $op['start'], $insertedLen, $isRelocationPaste);
        }

        $delta = $insertedLen - ($op['end'] - $op['start']);

        return self::applyReplace($span, $op['start'], $op['end'], $insertedLen, $delta);
    }

    /**
     * End-gravity absorbs typing done right after a span into it — but never
     * a relocation paste: the pasted words belong to the citation carried
     * with them, not to whatever span happens to end exactly where they
     * landed. Without this, pasting a cut line right after another cited
     * line silently extended the neighbour over the whole arrival.
     *
     * @param  WorkingSpan  $span
     * @return WorkingSpan
     */
    private static function applyInsertion(array $span, int $p, int $insertedLen, bool $isRelocationPaste = false): array
    {
        if ($p <= $span['start']) {
            $span['start'] += $insertedLen;
            $span['end'] += $insertedLen;

            return $span;
        }

        if ($isRelocationPaste ? $p < $span['end'] : $p <= $span['end']) {
            $span['end'] += $insertedLen;
        }

        return $span;
    }

    /**
     * @param  WorkingSpan  $span
     * @return WorkingSpan
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
                // Collapse to a zero-width tombstone at the point of
                // destruction and keep transforming — the caller keeps the
                // row (flagged) rather than deleting a span an editor made.
                $span['start'] = $start;
                $span['end'] = $start;
                $span['deleted'] = true;
                $span['needsReview'] = true;

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
