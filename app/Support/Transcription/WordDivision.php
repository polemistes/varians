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

    /** Texts shorter than this are sliced directly; longer ones through an index. */
    private const INDEXED_FROM = 4096;

    /** Characters between two entries of a text's byte-offset index. */
    private const CHECKPOINT = 256;

    /** Distinct long texts remembered at once — a request's layers, not a corpus. */
    private const INDEXES_KEPT = 16;

    /**
     * Byte-offset indexes of the long texts seen, by fingerprint — see slice().
     *
     * @var array<string, array{text: string, byte_at: list<int>}>
     */
    private static array $indexes = [];

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
        return preg_replace(self::JOIN, '', self::slice($text, $start, $end)) ?? '';
    }

    /**
     * The characters from $start to $end of a text — mb_substr, but not
     * linear in $start. A character offset into UTF-8 has to be counted
     * from the text's beginning, so mb_substr on a witness of hundreds of
     * pages costs the whole text every word, and the edition page slices a
     * word for every reading of every column (real measurement: a
     * fifty-line window took four times as long with 95 K characters
     * before it). A long text gets an index of byte offsets every
     * CHECKPOINT characters, built once and kept by a cheap fingerprint of
     * the string (its length and the CRC of its ends, then the string
     * itself compared — pointer-equal for the same model attribute), so a
     * slice reads only the window it needs.
     */
    public static function slice(string $text, int $start, int $end): string
    {
        $length = $end - $start;

        if ($length <= 0) {
            return '';
        }

        if (strlen($text) < self::INDEXED_FROM) {
            return mb_substr($text, $start, $length);
        }

        $byteAt = self::byteIndex($text);
        $first = intdiv(max(0, $start), self::CHECKPOINT);
        $last = intdiv(max(0, $end), self::CHECKPOINT) + 1;
        $byteStart = $byteAt[$first] ?? strlen($text);
        $byteEnd = $byteAt[$last] ?? strlen($text);

        return mb_substr(substr($text, $byteStart, $byteEnd - $byteStart), $start - $first * self::CHECKPOINT, $length);
    }

    /**
     * Byte offsets of every CHECKPOINTth character of the text, the byte
     * length last.
     *
     * @return list<int>
     */
    private static function byteIndex(string $text): array
    {
        $fingerprint = strlen($text).':'.crc32(substr($text, 0, 64).substr($text, -64));
        $known = self::$indexes[$fingerprint] ?? null;

        if ($known !== null && $known['text'] === $text) {
            return $known['byte_at'];
        }

        $byteAt = [0];
        $offset = 0;

        foreach (mb_str_split($text, self::CHECKPOINT) as $chunk) {
            $offset += strlen($chunk);
            $byteAt[] = $offset;
        }

        if (count(self::$indexes) >= self::INDEXES_KEPT) {
            self::$indexes = [];
        }

        self::$indexes[$fingerprint] = ['text' => $text, 'byte_at' => $byteAt];

        return $byteAt;
    }

    /**
     * The text of a span as the manuscript has it, for an apparatus's "as
     * written": the line-end division kept and shown as "ἄνδ-|ρα".
     */
    public static function asWritten(string $text, int $start, int $end): string
    {
        return preg_replace(self::JOIN, '-|', self::slice($text, $start, $end)) ?? '';
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
