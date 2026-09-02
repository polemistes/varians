<?php

namespace App\Support\Transcription;

/**
 * The structural relationship between a transcription's two layers.
 *
 * Normalization operates INSIDE words — orthography, accents, breathings,
 * punctuation attached to a word (γίγνομαι/γίνομαι differ in length, never
 * in position). It never reorders, adds or removes words: even crasis stays
 * fused, since splitting it is an emendation for the conjecture system, not
 * normalization. So when both layers have text, they must share the same
 * word sequence and the same line structure, and that shared skeleton is
 * what this class measures. Character offsets stay per-layer.
 */
class LayerCorrespondence
{
    /**
     * The first place the two layers' word structures disagree, or null when
     * they are in step. Compared line by line, by word count — spellings
     * legitimately differ, positions do not. A line one text does not have
     * reports null for its word count.
     *
     * @return array{line: int, a_words: int|null, b_words: int|null}|null
     */
    public static function divergence(string $a, string $b): ?array
    {
        $aLines = explode("\n", $a);
        $bLines = explode("\n", $b);
        $lines = max(count($aLines), count($bLines));

        for ($index = 0; $index < $lines; $index++) {
            $aWords = isset($aLines[$index]) ? count(self::words($aLines[$index])) : null;
            $bWords = isset($bLines[$index]) ? count(self::words($bLines[$index])) : null;

            if ($aWords !== $bWords) {
                return ['line' => $index + 1, 'a_words' => $aWords, 'b_words' => $bWords];
            }
        }

        return null;
    }

    /**
     * The text with every word collapsed to a single mark, leaving the
     * whitespace verbatim. Two texts with equal patterns have the same words
     * in the same places separated by the very same characters — the exact
     * precondition under which an offset at a word boundary in one layer
     * names a definite offset in the other.
     */
    public static function pattern(string $text): string
    {
        return preg_replace('/\S+/u', 'w', $text) ?? $text;
    }

    /**
     * The words of one line or text, as offset spans.
     *
     * @return list<array{start: int, end: int}>
     */
    public static function words(string $text): array
    {
        preg_match_all('/\S+/u', $text, $matches, PREG_OFFSET_CAPTURE);

        $words = [];

        foreach ($matches[0] as [$word, $byteOffset]) {
            // preg offsets are bytes; spans everywhere else are characters.
            $start = mb_strlen(substr($text, 0, $byteOffset));
            $words[] = ['start' => $start, 'end' => $start + mb_strlen($word)];
        }

        return $words;
    }
}
