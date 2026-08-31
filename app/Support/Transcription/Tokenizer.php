<?php

namespace App\Support\Transcription;

use App\Enums\Tokenization;

/**
 * Divides a span of a transcription's text into the tokens collation aligns
 * on (see App\Support\Edition\PassageAligner), according to the work's own
 * Tokenization strategy.
 *
 * Every token carries its offsets in the *whole* transcription text, not in
 * the extracted substring — PassageAligner persists them directly onto
 * LemmaReading, which indexes into the full text.
 */
class Tokenizer
{
    /**
     * @param  string  $fullText  the transcription's whole `text` field
     * @return list<array{text: string, start: int, end: int}>
     */
    public static function tokenize(string $fullText, int $start, int $end, Tokenization $strategy): array
    {
        return match ($strategy) {
            Tokenization::Whitespace => self::whitespace($fullText, $start, $end),
        };
    }

    /**
     * Split on runs of whitespace, keeping every token's offset in the full
     * text. Whitespace itself is never a token — it only advances the offset.
     *
     * @return list<array{text: string, start: int, end: int}>
     */
    private static function whitespace(string $fullText, int $start, int $end): array
    {
        $substring = mb_substr($fullText, $start, $end - $start);
        $tokens = [];
        $offset = 0;
        $pieces = preg_split('/(\s+)/u', $substring, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];

        foreach ($pieces as $index => $piece) {
            $length = mb_strlen($piece);

            if ($piece === '' || $index % 2 === 1) {
                $offset += $length;

                continue;
            }

            $tokens[] = ['text' => $piece, 'start' => $start + $offset, 'end' => $start + $offset + $length];
            $offset += $length;
        }

        return $tokens;
    }
}
