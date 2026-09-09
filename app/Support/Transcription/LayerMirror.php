<?php

namespace App\Support\Transcription;

/**
 * Derives the sibling layer's op list for an edit, so that what happens to
 * the WORDS of one layer happens to the words of the other.
 *
 * The two layers share a word skeleton (see LayerCorrespondence): the same
 * words in the same lines, only spellings differing. Two kinds of edit
 * respect that skeleton and therefore mirror:
 *
 * - a cut/paste pair moving whole words is replayed on the sibling using
 *   ITS OWN spellings (a relocation means the same thing in either layer);
 * - an ATOMIC insertion, deletion or replacement whose endpoints sit on
 *   word boundaries is replayed VERBATIM — pasting or importing words puts
 *   the same words in both layers (spellings adjusted later), deleting a
 *   selected word removes its counterpart. Atomic means the client marked
 *   it so (paste, import, undo/redo, strip, a selection-wide deletion);
 *   character-by-character typing never mirrors, because the first
 *   keystroke of a spelling change is indistinguishable from it, and
 *   mirroring it would destroy the sibling's own reading.
 *
 * A relocation pair that cannot mirror (a cut through the middle of a word,
 * skeletons already apart) abandons the WHOLE mirror (null) rather than
 * moving text in one layer only. An unmirrorable plain op is merely
 * skipped: a spelling edit inside a word is exactly the divergence the
 * layers exist for, and everything else shows in the in-step indicator.
 */
class LayerMirror
{
    /**
     * @param  string  $aText  the edited layer's text BEFORE the ops
     * @param  list<array{start: int, end: int, text: string, cut_id: string|null, atomic?: bool, mirror_text?: string|null}>  $ops  normalized and pair-verified (see TranscriptionTextController::normalizeOps)
     * @param  string  $bText  the sibling layer's current text
     * @return array{ops: list<array{start: int, end: int, text: string, cut_id: string|null}>, text: string, relocated: bool}|null
     */
    public static function mirror(string $aText, array $ops, string $bText): ?array
    {
        $roles = [];

        foreach (RelocationSegmentEffects::pairs($ops) as [$cutIndex, $pasteIndex]) {
            $roles[$cutIndex] = 'cut';
            $roles[$pasteIndex] = 'paste';
        }

        $a = $aText;
        $b = $bText;
        $bOps = [];
        $stash = [];
        $relocated = false;

        foreach ($ops as $index => $op) {
            $role = $roles[$index] ?? null;
            // The skeletons must agree at the moment an op applies — an
            // unmirrored edit earlier in the log may have parted them.
            $inStep = LayerCorrespondence::pattern($a) === LayerCorrespondence::pattern($b);

            if ($role !== null) {
                if (! $inStep) {
                    return null;
                }

                $start = self::mapOffset($a, $b, $op['start']);
                $end = $role === 'cut' ? self::mapOffset($a, $b, $op['end']) : $start;

                if ($start === null || $end === null) {
                    return null;
                }

                if ($role === 'cut') {
                    $taken = mb_substr($b, $start, $end - $start);

                    // The words must CORRESPOND, not merely count the same:
                    // the in-step pattern check is structural (word shapes
                    // and whitespace), so layers whose lines drifted to hold
                    // DIFFERENT words in the same shape still pass it — and
                    // an index-mapped cut then moves the wrong words (real
                    // incident: a mirrored paste landed mid-line, splitting
                    // a citation, because the sibling's words no longer
                    // matched). Orthography-folded equality is the layers'
                    // own definition of "the same word".
                    if (! self::foldMatches(mb_substr($a, $op['start'], $op['end'] - $op['start']), $taken)) {
                        return null;
                    }

                    $stash[$op['cut_id']] = $taken;
                    $bOp = ['start' => $start, 'end' => $end, 'text' => '', 'cut_id' => $op['cut_id']];
                } else {
                    $bOp = ['start' => $start, 'end' => $start, 'text' => $stash[$op['cut_id']], 'cut_id' => $op['cut_id']];
                }

                $bOps[] = $bOp;
                $b = TextOpApplier::apply($b, $bOp);
                $relocated = true;
            } elseif (($op['atomic'] ?? false) && $inStep) {
                $start = self::mapOffset($a, $b, $op['start']);

                // A LINE BREAK pressed inside a word still mirrors: pasting
                // a line flush against another glues two words into one, and
                // the Enter that separates them again lands mid-word, where
                // no plain offset maps. The sibling glued the same two words
                // in its own spellings, so the split point is wherever its
                // word's orthography-folded suffix matches ours.
                if (
                    $start === null
                    && $op['start'] === $op['end']
                    && self::isLineBreakInsertion($op['text'])
                ) {
                    $start = self::wordSplitOffset($a, $b, $op['start']);
                }

                $end = $op['end'] === $op['start']
                    ? $start
                    : self::mapOffset($a, $b, $op['end']);

                // A deletion or replacement must remove the sibling's
                // COUNTERPART words — skip the op when the mapped range
                // holds different words (see the relocation check above).
                if (
                    $start !== null
                    && $end !== null
                    && ($op['end'] === $op['start']
                        || self::foldMatches(
                            mb_substr($a, $op['start'], $op['end'] - $op['start']),
                            mb_substr($b, $start, $end - $start),
                        ))
                ) {
                    // An undo carries the sibling's OWN former words as
                    // `mirror_text` (the client snapshots them when the
                    // edit is made), so undoing a mirrored deletion puts
                    // back γίνεται in the normalized layer, not the
                    // diplomatic ΓΙΓΝΕΤΑΙ the edit removed there. Absent, a
                    // verbatim replay is the rule (user decision: same words
                    // in both layers, spellings adjusted later).
                    $bOp = ['start' => $start, 'end' => $end, 'text' => $op['mirror_text'] ?? $op['text'], 'cut_id' => null];
                    $bOps[] = $bOp;
                    $b = TextOpApplier::apply($b, $bOp);
                }
            }

            $a = TextOpApplier::apply($a, $op);
        }

        if ($bOps === []) {
            return null;
        }

        return ['ops' => $bOps, 'text' => $b, 'relocated' => $relocated];
    }

    /**
     * Whether two stretches carry the same words under the layers' own
     * definition of sameness. Word by word: orthography-folded equality, or
     * — since counterpart spellings can genuinely differ in letters
     * (γιγνεται/γίνεται, alpha/alfa; the same case wordSplitOffset handles)
     * — a shared folded prefix or suffix of at least two characters.
     * Entirely different words share neither, which is exactly what a
     * drifted sibling holds; and a whole moved range only corresponds when
     * EVERY word does, so coincidental affix matches don't accumulate into
     * a false whole.
     */
    private static function foldMatches(string $aText, string $bText): bool
    {
        $wordsOf = fn (string $text): array => preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $aWords = $wordsOf($aText);
        $bWords = $wordsOf($bText);

        if (count($aWords) !== count($bWords)) {
            return false;
        }

        foreach ($aWords as $index => $aWord) {
            $aFold = GreekText::foldOrthography($aWord);
            $bFold = GreekText::foldOrthography($bWords[$index]);

            if ($aFold === $bFold) {
                continue;
            }

            $shared = 0;

            while ($shared < mb_strlen($aFold) && $shared < mb_strlen($bFold)
                && mb_substr($aFold, $shared, 1) === mb_substr($bFold, $shared, 1)) {
                $shared++;
            }

            if ($shared >= 2) {
                continue;
            }

            $shared = 0;

            while ($shared < mb_strlen($aFold) && $shared < mb_strlen($bFold)
                && mb_substr($aFold, -1 - $shared, 1) === mb_substr($bFold, -1 - $shared, 1)) {
                $shared++;
            }

            if ($shared < 2) {
                return false;
            }
        }

        return true;
    }

    private static function isLineBreakInsertion(string $text): bool
    {
        return $text !== ''
            && str_contains($text, "\n")
            && preg_match('/^\s*$/u', $text) === 1;
    }

    /**
     * Where a mid-word line break in `$a` falls within the SAME word in
     * `$b`: the unique split of `$b`'s word whose orthography-folded suffix
     * (or, failing that, prefix) equals the fold of `$a`'s. Folding makes
     * the comparison spelling-blind (χαιρʼ and χαῖρʼ both fold to χαιρ), so
     * the junction of two glued words is found even when the OTHER half is
     * spelled apart at the letter level (γιγνεται/γίνεται) — either half
     * pinning the point uniquely is enough, since the junction is one
     * point. Null when neither half matches uniquely — a wrong guess would
     * break the sibling's word at the wrong letters, which is worse than
     * skipping.
     */
    private static function wordSplitOffset(string $a, string $b, int $offset): ?int
    {
        $aWords = LayerCorrespondence::words($a);
        $bWords = LayerCorrespondence::words($b);

        if (count($aWords) !== count($bWords)) {
            return null;
        }

        foreach ($aWords as $index => $word) {
            if ($word['start'] >= $offset) {
                return null;
            }

            if ($word['end'] <= $offset) {
                continue;
            }

            $aWord = mb_substr($a, $word['start'], $word['end'] - $word['start']);
            $bWord = mb_substr($b, $bWords[$index]['start'], $bWords[$index]['end'] - $bWords[$index]['start']);
            $split = self::uniqueSplit($bWord, GreekText::foldOrthography(mb_substr($a, $offset, $word['end'] - $offset)), false)
                ?? self::uniqueSplit($bWord, GreekText::foldOrthography(mb_substr($aWord, 0, $offset - $word['start'])), true);

            return $split === null ? null : $bWords[$index]['start'] + $split;
        }

        return null;
    }

    /**
     * The split of `$word` whose folded suffix (or prefix) is `$fold`.
     * Several splits can match, but only when nothing except fold-empty
     * material (punctuation) stands between them — folding is
     * concatenative, so fold-equal halves at two positions force the
     * stretch between to fold away. The RIGHTMOST match wins: punctuation
     * binds to the line it ends (Γενετυλλίδος, | νῦν — the comma stays
     * with the preceding line, as it does in the sibling's own lineation).
     */
    private static function uniqueSplit(string $word, string $fold, bool $prefix): ?int
    {
        if ($fold === '') {
            return null;
        }

        $length = mb_strlen($word);
        $splits = [];

        for ($at = 1; $at < $length; $at++) {
            $half = $prefix ? mb_substr($word, 0, $at) : mb_substr($word, $at);

            if (GreekText::foldOrthography($half) === $fold) {
                $splits[] = $at;
            }
        }

        return $splits === [] ? null : max($splits);
    }

    /**
     * The `$b` offset naming the same structural place as `$offset` does in
     * `$a` — defined only where the texts' patterns agree and the offset
     * stands at a word boundary or in the whitespace between words. Inside a
     * word there is no counterpart, because the spellings differ.
     */
    private static function mapOffset(string $a, string $b, int $offset): ?int
    {
        $aWords = LayerCorrespondence::words($a);
        $bWords = LayerCorrespondence::words($b);

        if (count($aWords) !== count($bWords)) {
            return null;
        }

        // The first word still open at the offset decides the case: strictly
        // inside it is unmappable; at or before its start, the offset sits in
        // the separator run after the previous word, whose characters are
        // identical in both layers (pattern equality), so the same distance
        // in from the previous word's end names the same character.
        foreach ($aWords as $index => $word) {
            if ($word['end'] > $offset) {
                if ($offset > $word['start']) {
                    return null;
                }

                $delta = $offset - ($index > 0 ? $aWords[$index - 1]['end'] : 0);

                return ($index > 0 ? $bWords[$index - 1]['end'] : 0) + $delta;
            }
        }

        $lastA = $aWords === [] ? 0 : end($aWords)['end'];
        $lastB = $bWords === [] ? 0 : end($bWords)['end'];

        return $lastB + ($offset - $lastA);
    }
}
