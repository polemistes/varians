<?php

namespace App\Support\Transcription;

/**
 * A word broken at the end of a manuscript line — or page — is ONE word.
 *
 * The transcription writes it as the manuscript has it, divided, with a
 * hyphen at the line's end saying that the word goes on: "ἄνδ-⏎ρα". The
 * hyphen is the transcriber's sign, not the scribe's; it means something
 * only when a line break follows it directly, so a hyphen anywhere else
 * is ordinary text. This is the one place whitespace does NOT separate
 * words (user decision, 2026-09-14), and the one place the definition of a
 * word lives: everything that finds words, checks their edges or reads
 * their text goes through here, so the two layers, collation, the edition
 * and the facsimile all agree that the division is not a division.
 *
 * Offsets stay honest about where the ink is: a reading's span still
 * covers the hyphen and the break. What changes is the word's TEXT — the
 * hyphen and the break are dropped when the span is read as a word, so
 * "ἄνδ-⏎ρα" collates as "ἄνδρα", prints as "ἄνδρα", and is no variant of a
 * witness that has it whole. Mirrored in resources/js/lib/wordSpans.ts and
 * greekText.ts — keep them in step.
 */
class WordDivision
{
    /** A hyphen and the line break it stands before, inside a word. */
    public const JOIN = '/-\R/u';

    /** A word: non-whitespace, with a hyphen's line break belonging to it. */
    public const WORD = '/(?:\S|(?<=-)\R)+/u';

    /**
     * The words of a text, as character offset spans.
     *
     * @return list<array{start: int, end: int}>
     */
    public static function words(string $text): array
    {
        preg_match_all(self::WORD, $text, $matches, PREG_OFFSET_CAPTURE);

        $words = [];

        foreach ($matches[0] as [$word, $byteOffset]) {
            // preg offsets are bytes; spans everywhere else are characters.
            $start = mb_strlen(substr($text, 0, $byteOffset));
            $words[] = ['start' => $start, 'end' => $start + mb_strlen($word)];
        }

        return $words;
    }

    /**
     * The text of a span read AS WORDS: what the words say, the manuscript's
     * line-end divisions closed up.
     */
    public static function wordText(string $text, int $start, int $end): string
    {
        return preg_replace(self::JOIN, '', mb_substr($text, $start, $end - $start)) ?? '';
    }

    /**
     * The text of a span as the manuscript has it, for an apparatus's "as
     * written": the line-end division kept and shown as "ἄνδ-|ρα".
     */
    public static function asWritten(string $text, int $start, int $end): string
    {
        return preg_replace(self::JOIN, '-|', mb_substr($text, $start, $end - $start)) ?? '';
    }

    /**
     * Whether the character at this offset separates words. Whitespace does
     * — except a line break that a hyphen stands before, which is inside a
     * word. Past either end of the text counts as a separator.
     */
    public static function isSeparatorAt(string $text, int $offset): bool
    {
        if ($offset < 0 || $offset >= mb_strlen($text)) {
            return true;
        }

        $character = mb_substr($text, $offset, 1);

        if (preg_match('/\s/u', $character) !== 1) {
            return false;
        }

        if ($character === "\n" || $character === "\r") {
            $before = $offset > 0 ? mb_substr($text, $offset - 1, 1) : '';

            // The "\n" of a "\r\n" pair: look past the "\r".
            if ($character === "\n" && $before === "\r") {
                $before = $offset > 1 ? mb_substr($text, $offset - 2, 1) : '';
            }

            return $before !== '-';
        }

        return true;
    }
}
