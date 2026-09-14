<?php

namespace App\Support\Transcription;

use App\Enums\Tokenization;

/**
 * Divides a span of a transcription's text into the tokens collation aligns
 * on (see App\Support\Edition\SegmentAligner), according to the work's own
 * Tokenization strategy.
 *
 * Every token carries its offsets in the *whole* transcription text, not in
 * the extracted substring — SegmentAligner persists them directly onto
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
     * Tokenize several spans as one sequence — the token stream of a segment
     * whose witness text is physically discontinuous (a transposition split
     * it), given the spans in *content* order. Offsets stay absolute into the
     * full text, so they remain valid across the gaps between spans.
     *
     * @param  list<array{start: int, end: int}>  $spans
     * @return list<array{text: string, start: int, end: int}>
     */
    public static function tokenizeSpans(string $fullText, array $spans, Tokenization $strategy): array
    {
        return array_merge(...array_map(
            fn (array $span) => self::tokenize($fullText, $span['start'], $span['end'], $strategy),
            $spans,
        ));
    }

    /**
     * Split on runs of whitespace, keeping every token's offset in the full
     * text. Whitespace itself is never a token — it only advances the offset.
     *
     * @return list<array{text: string, start: int, end: int}>
     */
    private static function whitespace(string $fullText, int $start, int $end): array
    {
        // Through the index: a span deep in a long text is not a walk from its start.
        $substring = WordDivision::slice($fullText, $start, $end);
        $tokens = [];

        // A word divided at a line's end ("ἄνδ-⏎ρα") is one token whose
        // text closes the division up — see WordDivision.
        foreach (WordDivision::words($substring) as $word) {
            $tokens[] = [
                'text' => WordDivision::wordText($substring, $word['start'], $word['end']),
                'start' => $start + $word['start'],
                'end' => $start + $word['end'],
            ];
        }

        return $tokens;
    }
}
