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
     * @param  list<array{start: int, end: int, text: string, cut_id: string|null, atomic?: bool}>  $ops  normalized and pair-verified (see TranscriptionTextController::normalizeOps)
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
                    $stash[$op['cut_id']] = mb_substr($b, $start, $end - $start);
                    $bOp = ['start' => $start, 'end' => $end, 'text' => '', 'cut_id' => $op['cut_id']];
                } else {
                    $bOp = ['start' => $start, 'end' => $start, 'text' => $stash[$op['cut_id']], 'cut_id' => $op['cut_id']];
                }

                $bOps[] = $bOp;
                $b = TextOpApplier::apply($b, $bOp);
                $relocated = true;
            } elseif (($op['atomic'] ?? false) && $inStep) {
                $start = self::mapOffset($a, $b, $op['start']);
                $end = $op['end'] === $op['start']
                    ? $start
                    : self::mapOffset($a, $b, $op['end']);

                if ($start !== null && $end !== null) {
                    $bOp = ['start' => $start, 'end' => $end, 'text' => $op['text'], 'cut_id' => null];
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
