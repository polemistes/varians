<?php

namespace App\Support\Transcription;

/**
 * An assignment is ASSIGNED on whole words, never on half of one and never on the
 * whitespace beside them. An editor dragging a selection catches a trailing
 * space or a line break without meaning to, and the aligner reads words, so
 * the bounds she gives are snapped out to the words she meant.
 *
 * This applies WHERE AN EDITOR ASSIGNS OR MOVES an assignment herself, and only
 * there. It is deliberately NOT run after a text edit: whitespace typed
 * against an assignment's words is the assignment's and stays where the editor
 * put it (user decision — pulling it back out read as the line having
 * ended, and left the next word outside the line as well). A word left
 * split by an edit is reported by AssignmentIntegrity rather than mended.
 */
class AssignmentBounds
{
    /**
     * Bounds snapped out to whole words: edge whitespace dropped, then any
     * word the bounds cut through taken in whole.
     *
     * @return array{0: int, 1: int}
     */
    public static function wholeWords(string $text, int $start, int $end): array
    {
        [$start, $end] = self::trimmed($text, $start, $end);

        if ($end <= $start) {
            return [$start, $end];
        }

        while ($start > 0 && ! self::isSeparator(mb_substr($text, $start - 1, 1))) {
            $start--;
        }

        $length = mb_strlen($text);

        while ($end < $length && ! self::isSeparator(mb_substr($text, $end, 1))) {
            $end++;
        }

        return [$start, $end];
    }

    /**
     * The same bounds without the whitespace at either edge. A span of
     * nothing but whitespace collapses, and is left where it stood.
     *
     * @return array{0: int, 1: int}
     */
    public static function trimmed(string $text, int $start, int $end): array
    {
        while ($start < $end && self::isSeparator(mb_substr($text, $start, 1))) {
            $start++;
        }

        while ($end > $start && self::isSeparator(mb_substr($text, $end - 1, 1))) {
            $end--;
        }

        return [$start, $end];
    }

    /**
     * Whitespace is the separator today. The one place to widen when a work
     * divides its words some other way — scriptio continua, interpuncts.
     */
    private static function isSeparator(string $character): bool
    {
        return $character === '' || preg_match('/\s/u', $character) === 1;
    }
}
