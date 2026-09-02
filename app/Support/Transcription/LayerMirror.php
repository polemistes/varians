<?php

namespace App\Support\Transcription;

/**
 * Derives the sibling layer's op list for a relocation, so that moving text
 * around in one layer moves the corresponding text in the other.
 *
 * The two layers share a word skeleton (see LayerCorrespondence); a cut/paste
 * pair that moves whole words along that skeleton means the same thing in
 * either spelling, so the move is replayed on the sibling using ITS OWN
 * words. Only relocations mirror: typed insertions and deletions have no
 * meaningful counterpart mid-keystroke, and simply leave the layers out of
 * step for the correspondence indicator to show.
 *
 * All or nothing: the whole derivation is simulated first, and anything
 * unmirrorable — a cut through the middle of a word, a paste inside one,
 * layers whose word patterns already disagree — abandons the mirror
 * entirely (returns null) rather than half-applying it. The layers then
 * drift visibly instead of corrupting silently.
 */
class LayerMirror
{
    /**
     * @param  string  $aText  the edited layer's text BEFORE the ops
     * @param  list<array{start: int, end: int, text: string, cut_id: string|null}>  $ops  normalized and pair-verified (see TranscriptionTextController::normalizeOps)
     * @param  string  $bText  the sibling layer's current text
     * @return array{ops: list<array{start: int, end: int, text: string, cut_id: string|null}>, text: string}|null
     */
    public static function mirror(string $aText, array $ops, string $bText): ?array
    {
        $pairs = RelocationSegmentEffects::pairs($ops);

        if ($pairs === []) {
            return null;
        }

        $roles = [];

        foreach ($pairs as [$cutIndex, $pasteIndex]) {
            $roles[$cutIndex] = 'cut';
            $roles[$pasteIndex] = 'paste';
        }

        $a = $aText;
        $b = $bText;
        $bOps = [];
        $stash = [];

        foreach ($ops as $index => $op) {
            $role = $roles[$index] ?? null;

            if ($role !== null) {
                // The skeletons must agree at the moment the half applies —
                // an unmirrored edit earlier in the log may have broken that.
                if (LayerCorrespondence::pattern($a) !== LayerCorrespondence::pattern($b)) {
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
            }

            $a = TextOpApplier::apply($a, $op);
        }

        return ['ops' => $bOps, 'text' => $b];
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
