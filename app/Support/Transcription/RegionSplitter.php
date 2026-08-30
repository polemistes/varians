<?php

namespace App\Support\Transcription;

/**
 * Splits a span of transcription text into "units" — non-whitespace
 * characters or words — each with its own character offsets, for batch
 * image-alignment: draw one guide box over a line/phrase and get one region
 * per unit, evenly divided along the box, without guessing at real letter
 * widths (which would need OCR-like detection this project is deliberately
 * avoiding).
 */
class RegionSplitter
{
    private const RESERVED_CHARS_PATTERN = '/[\[\]{}_]/u';

    /**
     * Whether a span of text is eligible for batch splitting. Text carrying
     * Leiden markup (gaps, restorations, uncertain readings) is not — a gap
     * has no ink to align, and mixing "real" and "guessed" text into one
     * uniform division would silently misplace every unit after it.
     */
    public static function isSplittable(string $text): bool
    {
        return preg_match(self::RESERVED_CHARS_PATTERN, $text) !== 1;
    }

    /**
     * @return list<array{start: int, end: int, text: string}>
     */
    public static function split(string $text, string $granularity): array
    {
        return $granularity === 'character'
            ? self::splitByCharacter($text)
            : self::splitByWord($text);
    }

    /**
     * @return list<array{start: int, end: int, text: string}>
     */
    private static function splitByCharacter(string $text): array
    {
        $units = [];

        foreach (mb_str_split($text) as $index => $char) {
            if (preg_match('/^\s$/u', $char) === 1) {
                continue;
            }

            $units[] = ['start' => $index, 'end' => $index + 1, 'text' => $char];
        }

        return $units;
    }

    /**
     * @return list<array{start: int, end: int, text: string}>
     */
    private static function splitByWord(string $text): array
    {
        $chars = mb_str_split($text);
        $units = [];
        $wordStart = null;

        foreach ($chars as $index => $char) {
            $isSpace = preg_match('/^\s$/u', $char) === 1;

            if (! $isSpace && $wordStart === null) {
                $wordStart = $index;
            }

            if ($isSpace && $wordStart !== null) {
                $units[] = self::word($chars, $wordStart, $index);
                $wordStart = null;
            }
        }

        if ($wordStart !== null) {
            $units[] = self::word($chars, $wordStart, count($chars));
        }

        return $units;
    }

    /**
     * @param  list<string>  $chars
     * @return array{start: int, end: int, text: string}
     */
    private static function word(array $chars, int $start, int $end): array
    {
        return [
            'start' => $start,
            'end' => $end,
            'text' => implode('', array_slice($chars, $start, $end - $start)),
        ];
    }
}
