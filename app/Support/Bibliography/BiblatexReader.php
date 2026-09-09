<?php

namespace App\Support\Bibliography;

/**
 * Reads a .bib file into entries the list can store — the way in for a
 * bibliography kept elsewhere. Hand-written for the standard shape:
 *
 *   @article{key,
 *     author = {Dover, K. J.},
 *     title  = "Aristophanes",
 *     year   = 1972,
 *   }
 *
 * Braced and quoted values, bare numbers, `#` concatenation of literal
 * pieces, nested braces, and `@comment`/`@preamble`/`@string` blocks
 * (`@string` macros are expanded where used). BibTeX's legacy types and
 * fields are mapped onto their biblatex names (`phdthesis` → `thesis` with
 * `type = {phdthesis}`, `journal` → `journaltitle`, `address` → `location`,
 * `school` → `institution`); fields the registry does not know are dropped
 * and reported, since the list stores nothing outside biblatex. An entry
 * that cannot be read is skipped and reported rather than stopping the
 * rest. LaTeX inside values is kept as written — it is biblatex's own.
 *
 * @phpstan-type ReadEntry array{entry_type: string, citation_key: string, fields: array<string, string>}
 * @phpstan-type ReadResult array{entries: list<ReadEntry>, warnings: list<string>}
 */
class BiblatexReader
{
    /** BibTeX types that biblatex spells differently. */
    private const TYPE_ALIASES = [
        'phdthesis' => ['thesis', 'phdthesis'],
        'mastersthesis' => ['thesis', 'mathesis'],
        'techreport' => ['report', 'techreport'],
        'conference' => ['inproceedings', null],
        'electronic' => ['online', null],
        'www' => ['online', null],
    ];

    /** BibTeX fields that biblatex spells differently. */
    private const FIELD_ALIASES = [
        'journal' => 'journaltitle',
        'address' => 'location',
        'school' => 'institution',
        'annote' => 'annotation',
        'key' => 'sortkey',
        'pdf' => 'file',
        'primaryclass' => 'eprintclass',
        'archiveprefix' => 'eprinttype',
    ];

    /**
     * @return ReadResult
     */
    public static function read(string $text): array
    {
        $entries = [];
        $warnings = [];
        $strings = [];
        $length = strlen($text);
        $position = 0;

        while (($at = strpos($text, '@', $position)) !== false) {
            $position = $at + 1;
            $nameEnd = self::scanWhile($text, $position, fn (string $c) => ctype_alpha($c));
            $name = strtolower(substr($text, $position, $nameEnd - $position));
            $position = self::skipSpace($text, $nameEnd);

            if ($name === '' || $position >= $length || ! in_array($text[$position], ['{', '('], true)) {
                continue;
            }

            $open = $text[$position];
            $close = $open === '{' ? '}' : ')';
            $bodyEnd = self::matchingClose($text, $position, $open, $close);

            if ($bodyEnd === null) {
                $warnings[] = "An unclosed @{$name} block at the end of the file was ignored.";

                break;
            }

            $body = substr($text, $position + 1, $bodyEnd - $position - 1);
            $position = $bodyEnd + 1;

            if ($name === 'comment' || $name === 'preamble') {
                continue;
            }

            if ($name === 'string') {
                foreach (self::fields($body, $strings) as $macro => $value) {
                    $strings[strtolower($macro)] = $value;
                }

                continue;
            }

            $comma = strpos($body, ',');
            $key = trim($comma === false ? $body : substr($body, 0, $comma));

            if ($key === '' || preg_match('/^[A-Za-z0-9_:.\-]+$/', $key) !== 1) {
                $warnings[] = 'An @'.$name.' entry '.($key === '' ? 'without a key' : 'with the unusable key “'.$key.'”').' was skipped.';

                continue;
            }

            [$type, $typeField] = self::TYPE_ALIASES[$name] ?? [$name, null];

            if (! Biblatex::isType($type)) {
                $warnings[] = "@{$name} is not a biblatex entry type — “{$key}” was skipped.";

                continue;
            }

            $fields = [];
            $dropped = [];

            foreach (self::fields($comma === false ? '' : substr($body, $comma + 1), $strings) as $field => $value) {
                $field = self::FIELD_ALIASES[strtolower($field)] ?? strtolower($field);

                if (! Biblatex::isField($field)) {
                    $dropped[] = $field;

                    continue;
                }

                if (trim($value) !== '') {
                    $fields[$field] = trim($value);
                }
            }

            if ($typeField !== null && ! isset($fields['type'])) {
                $fields['type'] = $typeField;
            }

            if ($dropped !== []) {
                $warnings[] = '“'.$key.'”: not biblatex fields, dropped — '.implode(', ', $dropped).'.';
            }

            if (! isset($fields['title'])) {
                $warnings[] = '“'.$key.'” has no title and was skipped.';

                continue;
            }

            $entries[] = ['entry_type' => $type, 'citation_key' => $key, 'fields' => $fields];
        }

        return ['entries' => $entries, 'warnings' => $warnings];
    }

    /**
     * The `name = value` pairs of an entry body, values resolved.
     *
     * @param  array<string, string>  $strings
     * @return array<string, string>
     */
    private static function fields(string $body, array $strings): array
    {
        $fields = [];
        $length = strlen($body);
        $position = 0;

        while ($position < $length) {
            $position = self::skipSpace($body, $position);
            $nameEnd = self::scanWhile($body, $position, fn (string $c) => ctype_alnum($c) || $c === '_' || $c === '-');
            $name = substr($body, $position, $nameEnd - $position);
            $position = self::skipSpace($body, $nameEnd);

            if ($name === '' || $position >= $length || $body[$position] !== '=') {
                // Not a field: skip to the next comma at depth zero.
                $position = self::nextTopLevelComma($body, $position) + 1;

                continue;
            }

            $position = self::skipSpace($body, $position + 1);
            [$value, $position] = self::value($body, $position, $strings);
            $fields[$name] = $value;
            $position = self::nextTopLevelComma($body, $position) + 1;
        }

        return $fields;
    }

    /**
     * A value: braced, quoted, bare, or several of those joined with `#`.
     *
     * @param  array<string, string>  $strings
     * @return array{0: string, 1: int} the value and the position after it
     */
    private static function value(string $body, int $position, array $strings): array
    {
        $parts = [];
        $length = strlen($body);

        while (true) {
            $position = self::skipSpace($body, $position);

            if ($position >= $length) {
                break;
            }

            $char = $body[$position];

            if ($char === '{') {
                $end = self::matchingClose($body, $position, '{', '}') ?? $length - 1;
                $parts[] = substr($body, $position + 1, $end - $position - 1);
                $position = $end + 1;
            } elseif ($char === '"') {
                $end = self::closingQuote($body, $position);
                $parts[] = substr($body, $position + 1, $end - $position - 1);
                $position = $end + 1;
            } else {
                $end = self::scanWhile($body, $position, fn (string $c) => ! in_array($c, [',', '#', '}', ')'], true) && ! ctype_space($c));
                $bare = substr($body, $position, $end - $position);
                $parts[] = is_numeric($bare) ? $bare : ($strings[strtolower($bare)] ?? $bare);
                $position = $end;
            }

            $position = self::skipSpace($body, $position);

            if ($position < $length && $body[$position] === '#') {
                $position++;

                continue;
            }

            break;
        }

        return [preg_replace('/\s+/', ' ', implode('', $parts)) ?? '', $position];
    }

    private static function matchingClose(string $text, int $open, string $openChar, string $closeChar): ?int
    {
        $depth = 0;
        $length = strlen($text);

        for ($i = $open; $i < $length; $i++) {
            if ($text[$i] === '\\') {
                $i++;

                continue;
            }

            if ($text[$i] === $openChar || ($openChar === '(' && $text[$i] === '{')) {
                $depth++;
            } elseif ($text[$i] === $closeChar || ($openChar === '(' && $text[$i] === '}')) {
                $depth--;

                if ($depth === 0) {
                    return $i;
                }
            }
        }

        return null;
    }

    private static function closingQuote(string $text, int $open): int
    {
        $depth = 0;
        $length = strlen($text);

        for ($i = $open + 1; $i < $length; $i++) {
            if ($text[$i] === '\\') {
                $i++;
            } elseif ($text[$i] === '{') {
                $depth++;
            } elseif ($text[$i] === '}') {
                $depth--;
            } elseif ($text[$i] === '"' && $depth === 0) {
                return $i;
            }
        }

        return $length - 1;
    }

    private static function nextTopLevelComma(string $text, int $from): int
    {
        $depth = 0;
        $length = strlen($text);

        for ($i = $from; $i < $length; $i++) {
            if ($text[$i] === '{') {
                $depth++;
            } elseif ($text[$i] === '}') {
                $depth--;
            } elseif ($text[$i] === ',' && $depth <= 0) {
                return $i;
            }
        }

        return $length;
    }

    /**
     * @param  callable(string): bool  $accept
     */
    private static function scanWhile(string $text, int $from, callable $accept): int
    {
        $length = strlen($text);

        while ($from < $length && $accept($text[$from])) {
            $from++;
        }

        return $from;
    }

    private static function skipSpace(string $text, int $from): int
    {
        return self::scanWhile($text, $from, fn (string $c) => ctype_space($c));
    }
}
