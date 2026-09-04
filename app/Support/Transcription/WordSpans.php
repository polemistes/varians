<?php

namespace App\Support\Transcription;

/**
 * Projections between character offsets and word coordinates — the
 * foundation of transcript-level spans. The two layers of a transcript
 * share a word skeleton (see LayerCorrespondence): word 12 is word 12 in
 * either spelling, however many characters each form takes
 * (γίγνομαι/γίνομαι), so a span stored as a WORD RANGE of the transcript
 * projects onto each layer's own character offsets exactly.
 *
 * Word ranges are [start, end) in word indices and snap OUTWARD from
 * characters: citations are word-granular (user decision). Anchors address
 * sub-word points for facsimile mappings: {word, char-within-word}, read
 * against each layer's own spelling and clamped to its length — exact
 * where spellings agree, proportionally approximate where they differ,
 * which is all a mapping box claims anyway.
 *
 * Mirrored in resources/js/lib/wordSpans.ts — keep the two in step.
 */
class WordSpans
{
    /**
     * The word range covering [$start, $end), snapped outward to whole
     * words. A range touching no word collapses to [i, i) at the word
     * boundary it sits before.
     *
     * @return array{0: int, 1: int}
     */
    public static function toWordRange(string $text, int $start, int $end): array
    {
        $words = LayerCorrespondence::words($text);

        $from = count($words);

        foreach ($words as $index => $word) {
            if ($word['end'] > $start) {
                $from = $index;

                break;
            }
        }

        $to = 0;

        foreach ($words as $index => $word) {
            if ($word['start'] < $end) {
                $to = $index + 1;
            }
        }

        return $to > $from ? [$from, $to] : [$from, $from];
    }

    /**
     * The character range a word range covers in this layer's spelling.
     * An empty range collapses to the boundary before its start word.
     *
     * @return array{0: int, 1: int}
     */
    public static function toCharRange(string $text, int $startWord, int $endWord): array
    {
        $words = LayerCorrespondence::words($text);
        $count = count($words);

        if ($count === 0) {
            return [0, 0];
        }

        if ($endWord <= $startWord) {
            $at = $startWord >= $count
                ? $words[$count - 1]['end']
                : $words[max(0, $startWord)]['start'];

            return [$at, $at];
        }

        $start = $words[min(max(0, $startWord), $count - 1)]['start'];
        $end = $words[min($endWord, $count) - 1]['end'];

        return [$start, $end];
    }

    /**
     * A sub-word anchor for the START of a mapping: inside a word it stays
     * put; in the whitespace between words it snaps forward to the next
     * word's first character.
     *
     * @return array{word: int, char: int}
     */
    public static function startAnchor(string $text, int $offset): array
    {
        $words = LayerCorrespondence::words($text);

        foreach ($words as $index => $word) {
            if ($word['end'] > $offset) {
                return [
                    'word' => $index,
                    'char' => max(0, $offset - $word['start']),
                ];
            }
        }

        $last = count($words) - 1;

        return $last < 0
            ? ['word' => 0, 'char' => 0]
            : ['word' => $last, 'char' => $words[$last]['end'] - $words[$last]['start']];
    }

    /**
     * A sub-word anchor for the END of a mapping: inside a word it stays
     * put; in the whitespace between words it snaps back to the previous
     * word's end.
     *
     * @return array{word: int, char: int}
     */
    public static function endAnchor(string $text, int $offset): array
    {
        $words = LayerCorrespondence::words($text);

        for ($index = count($words) - 1; $index >= 0; $index--) {
            $word = $words[$index];

            if ($word['start'] < $offset) {
                return [
                    'word' => $index,
                    'char' => min($offset, $word['end']) - $word['start'],
                ];
            }
        }

        return ['word' => 0, 'char' => 0];
    }

    /**
     * The character offset an anchor names in this layer's spelling — the
     * word's start plus the within-word position, clamped to the word's own
     * length (spellings differ in length across layers).
     */
    public static function fromAnchor(string $text, int $word, int $char): int
    {
        $words = LayerCorrespondence::words($text);
        $count = count($words);

        if ($count === 0) {
            return 0;
        }

        $target = $words[min(max(0, $word), $count - 1)];

        return $target['start'] + min($char, $target['end'] - $target['start']);
    }
}
