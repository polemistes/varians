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
 * A pure insertion (start === end) joins the span it TOUCHES (user decision).
 * The caret touches a span when nothing stands between it and that span's text:
 * at the span's first character, at its last, or anywhere within. Since a
 * citation never owns the whitespace at its edges (see CitationBounds), what
 * lies between two of them is a visible gap of unassigned whitespace, and a
 * caret placed in that gap touches neither — so what is typed there joins
 * nothing, and the span after it is pushed along as ever.
 *
 * This is what makes typing in front of a cited line's first word write INTO
 * that line, which is what an editor means by it. Where two spans meet with no
 * whitespace between them both are touched at once, and the one that BEGINS
 * there takes the text: typing in front of a word belongs to that word's
 * citation, not to whatever ended against it.
 *
 * Whitespace typed at an edge joins the span like anything else and is then
 * trimmed straight back out of it — which is how pressing space or Enter widens
 * the gap rather than growing the citation.
 *
 * A relocation paste is exempt throughout: those words belong to the citation
 * carried with them, never to a neighbour they happen to land against.
 *
 * `$takesTextAtStart` turns this on, and ONLY CITATIONS get it. A facsimile
 * region is anchored to ink on parchment and a LemmaReading is a quotation
 * standing in an apparatus; neither grows because someone typed in front of
 * it, so both keep the plain rule — text arriving at their start pushes them
 * along.
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
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null, side?: string|null, imported?: bool}>  $ops
     * @return list<array{start: int, end: int, needsReview: bool, deleted: bool}>
     */
    public static function transform(array $spans, array $ops, bool $takesTextAtStart = false, ?string $text = null): array
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
            // Which citation, if any, takes what is typed here.
            $claim = $takesTextAtStart && $op['start'] === $op['end'] && ! $isPaste
                ? self::claimant($results, $op['start'], $op['side'] ?? null, $op['text'], $text, (bool) ($op['imported'] ?? false))
                : null;
            $index = -1;

            $results = array_map(function (array $span) use ($op, $cutId, $isCut, $isPaste, $takesTextAtStart, $claim, &$index) {
                $index++;
                $beginsHere = $takesTextAtStart && $index === $claim;
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
                    $span = self::applyOp($span, $op, $isPaste, $beginsHere, $takesTextAtStart);
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

                return self::applyOp($span, $op, $isPaste, $beginsHere, $takesTextAtStart);
            }, $results);

            if ($text !== null) {
                $text = mb_substr($text, 0, $op['start']).$op['text'].mb_substr($text, $op['end']);
            }
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
    private static function applyOp(array $span, array $op, bool $isRelocationPaste = false, bool $claims = false, bool $citations = false): array
    {
        $insertedLen = mb_strlen($op['text']);

        if ($op['start'] === $op['end']) {
            return self::applyInsertion($span, $op['start'], $insertedLen, $isRelocationPaste, $claims, $citations);
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
    private static function applyInsertion(array $span, int $p, int $insertedLen, bool $isRelocationPaste = false, bool $claims = false, bool $citations = false): array
    {
        // For citations the claim decides everything: the one citation that
        // takes the text grows to cover it, and every other is only pushed
        // along (see claimant()).
        if ($citations && ! $isRelocationPaste) {
            if ($claims) {
                // A citation carrying on across a gap has to reach over the
                // whitespace to cover what was typed beyond it.
                $span['end'] = $p > $span['end']
                    ? $p + $insertedLen
                    : $span['end'] + $insertedLen;

                return $span;
            }

            if ($p <= $span['start']) {
                $span['start'] += $insertedLen;
                $span['end'] += $insertedLen;
            }

            return $span;
        }

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
     * Which citation takes what is typed at this point, by index, or null
     * when none does.
     *
     * TOUCHING means touching: nothing at all between the caret and the
     * citation's characters. Standing against its words claims for it —
     * inside, at its first character, or at its last — and WHATEVER is typed
     * there is the citation's, a space as much as a letter (user report: a
     * space typed against the last word was being left outside the line, and
     * then the word after it as well). Nothing is trimmed back out
     * afterwards, so the space stays where the editor put it and what
     * follows carries on the line.
     *
     * A caret with whitespace between it and every citation claims for none
     * of them. That whitespace is the gap, and the gap is nobody's.
     *
     * Order where several are touched at once: inside, then at the first
     * character, then at the last. So where two citations meet flush the one
     * BEGINNING there takes it, and typing in front of a word belongs to
     * that word's citation.
     *
     * `$side` settles the one case the offset cannot. A citation's marker
     * stands at its first character, and BOTH SIDES OF THE MARKER MEASURE TO
     * THE SAME OFFSET — so which side the caret stood on is the difference
     * between writing into that citation and writing in front of its marker,
     * and only the editor's caret knows it. Typing on the marker's near side
     * therefore does NOT write into the citation it announces; whatever ends
     * against the marker takes it, or nobody does.
     *
     * The near side of a marker is only somebody else's where a citation
     * actually ENDS there. Withholding the claim regardless left words typed
     * at a citation's marker belonging to nobody, which is how unassigned
     * text appeared between two citations (user report).
     *
     * A citation never BEGINS with whitespace, so it does not claim a space
     * or a line break typed at its first character: that whitespace belongs
     * above it, and the citation — its marker with it — moves down onto the
     * words. Pressing Enter at the start of a cited line used to leave the
     * marker stranded on the line above (user report). Whitespace typed at
     * the citation's END is a different matter and IS claimed: it holds the
     * line open for the next word.
     *
     * @param  list<WorkingSpan>  $spans
     */
    private static function claimant(array $spans, int $p, ?string $side = null, string $inserted = '', ?string $text = null, bool $imported = false): ?int
    {
        $atEnd = null;
        $opensWithSpace = $inserted !== '' && preg_match('/^\s/u', $inserted) === 1;

        foreach ($spans as $index => $span) {
            if ($span['carried'] !== null || $span['end'] <= $span['start']) {
                continue;
            }

            if ($p > $span['start'] && $p < $span['end']) {
                return $index;
            }

            if ($p === $span['start'] && ! $opensWithSpace
                && ($side !== 'before' || ! self::spanEndsAt($spans, $p))) {
                return $index;
            }

            if ($p === $span['end']) {
                $atEnd = $index;
            }
        }

        if ($atEnd !== null) {
            return $atEnd;
        }

        // Whitespace typed at a citation's first character is the gap above
        // it, and must not be handed to the citation BEFORE either — or
        // pressing Enter at the start of a cited line would stretch the line
        // above instead of pushing this one down.
        if ($opensWithSpace && self::spanStartsAt($spans, $p)) {
            return null;
        }

        // Nothing touches the caret. Between two citations, with nothing but
        // whitespace either way, TYPING still must not leave words uncited
        // in the midst of cited text (user decision) — the citation before
        // takes them, carrying on where it left off. A deliberate stretch of
        // uncited text is a thing an editor asks for outright, not something
        // typing produces by accident. Imported text is the exception: it
        // arrives uncited and stays so.
        return $imported || $text === null ? null : self::enclosing($spans, $p, $text);
    }

    /**
     * The citation that CARRIES ON at this point: the one ending before it
     * with only whitespace between, provided another begins after it on the
     * same terms. Where one side has no citation at all the caret is not in
     * the midst of cited text, and what is typed there belongs to nobody.
     *
     * @param  list<WorkingSpan>  $spans
     */
    private static function enclosing(array $spans, int $p, string $text): ?int
    {
        $before = null;
        $after = false;

        foreach ($spans as $index => $span) {
            if ($span['carried'] !== null || $span['end'] <= $span['start']) {
                continue;
            }

            if ($span['end'] <= $p && self::onlySeparators($text, $span['end'], $p)
                && ($before === null || $span['end'] > $spans[$before]['end'])) {
                $before = $index;
            }

            if ($span['start'] >= $p && self::onlySeparators($text, $p, $span['start'])) {
                $after = true;
            }
        }

        return $after ? $before : null;
    }

    /** Whether everything between two offsets is separator, or nothing at all. */
    private static function onlySeparators(string $text, int $from, int $to): bool
    {
        $between = mb_substr($text, $from, $to - $from);

        return $between === '' || preg_match('/^\s+$/u', $between) === 1;
    }

    /**
     * Whether a live span begins exactly here.
     *
     * @param  list<WorkingSpan>  $spans
     */
    private static function spanStartsAt(array $spans, int $p): bool
    {
        foreach ($spans as $span) {
            if ($span['carried'] === null && $span['end'] > $span['start'] && $span['start'] === $p) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether a live span ends exactly here — whether, in other words, the
     * near side of a marker at this offset belongs to anybody.
     *
     * @param  list<WorkingSpan>  $spans
     */
    private static function spanEndsAt(array $spans, int $p): bool
    {
        foreach ($spans as $span) {
            if ($span['carried'] === null && $span['end'] > $span['start'] && $span['end'] === $p) {
                return true;
            }
        }

        return false;
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
