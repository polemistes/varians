<?php

namespace App\Support\Transcription;

/**
 * Splits a span of transcription text into "units" — non-whitespace
 * characters or words — each with its own character offsets, for batch
 * image-alignment: draw one guide box over the selected text's lines and get
 * one region per unit, laid out by character count, without guessing at real
 * letter widths (which would need OCR-like detection this project is
 * deliberately avoiding).
 *
 * `layout()` adds the geometry: each newline-separated line of the selection
 * becomes one horizontal band of the guide box, and within a band every unit
 * takes the horizontal share its characters have of the line — so a long
 * word gets a wide box, and the gap between words keeps a space's width.
 * Still an approximation to fine-tune afterward, not letter detection.
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
     * Lay the selection's units out over a guide box drawn across its lines.
     *
     * `lines` counts the bands the box divides into vertically — one per
     * line of the selection that has anything to align (a blank line takes
     * no band). Each unit carries its band (`line`) and its horizontal
     * `x`/`width` as fractions of the box, proportional to character
     * positions within the line: the first unit starts at the band's left
     * edge, the last ends at its right, and whitespace between units keeps
     * its share of the width. Offsets are relative to the whole selection.
     *
     * @return array{lines: int, units: list<array{start: int, end: int, text: string, line: int, x: float, width: float}>}
     */
    public static function layout(string $text, string $granularity): array
    {
        $units = [];
        $line = 0;
        $offset = 0;

        foreach (explode("\n", $text) as $lineText) {
            $lineUnits = self::split($lineText, $granularity);

            if ($lineUnits !== []) {
                $first = $lineUnits[0]['start'];
                $span = $lineUnits[count($lineUnits) - 1]['end'] - $first;

                foreach ($lineUnits as $unit) {
                    $units[] = [
                        'start' => $offset + $unit['start'],
                        'end' => $offset + $unit['end'],
                        'text' => $unit['text'],
                        'line' => $line,
                        'x' => ($unit['start'] - $first) / $span,
                        'width' => ($unit['end'] - $unit['start']) / $span,
                    ];
                }

                $line++;
            }

            $offset += mb_strlen($lineText) + 1;
        }

        return ['lines' => $line, 'units' => $units];
    }

    /**
     * `line` treats the whole (trimmed) text as one unit — callers hand
     * `split` a single line at a time; `layout` is where lines divide.
     *
     * @return list<array{start: int, end: int, text: string}>
     */
    public static function split(string $text, string $granularity): array
    {
        return match ($granularity) {
            'character' => self::splitByCharacter($text),
            'line' => self::splitByLine($text),
            default => self::splitByWord($text),
        };
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
     * @return list<array{start: int, end: int, text: string}>
     */
    private static function splitByLine(string $text): array
    {
        $chars = mb_str_split($text);
        $start = null;
        $end = 0;

        foreach ($chars as $index => $char) {
            if (preg_match('/^\s$/u', $char) !== 1) {
                $start ??= $index;
                $end = $index + 1;
            }
        }

        if ($start === null) {
            return [];
        }

        return [self::word($chars, $start, $end)];
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
