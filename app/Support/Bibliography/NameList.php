<?php

namespace App\Support\Bibliography;

/**
 * biblatex name lists: "Last, First and Last, First", or "First Last" for a
 * name given the other way round, with "and" between names and braces
 * protecting anything that must not be split. Parsed into family/given
 * pairs for display and for the label; serialized back in the first form,
 * which is the unambiguous one.
 *
 * @phpstan-type Name array{family: string, given: string}
 */
class NameList
{
    /**
     * @return list<Name>
     */
    public static function parse(string $list): array
    {
        $names = [];

        foreach (self::splitOutsideBraces($list, ' and ') as $raw) {
            $raw = trim($raw);

            if ($raw === '') {
                continue;
            }

            $parts = self::splitOutsideBraces($raw, ',');

            if (count($parts) >= 2) {
                // "Last, First" (a von part or a Jr. stay with the family
                // name — enough for a label, and biblatex keeps the string).
                $names[] = [
                    'family' => self::unbrace(trim($parts[0])),
                    'given' => self::unbrace(trim(implode(',', array_slice($parts, 1)))),
                ];

                continue;
            }

            if (str_starts_with($raw, '{') && str_ends_with($raw, '}')) {
                // A corporate author, braced whole.
                $names[] = ['family' => self::unbrace($raw), 'given' => ''];

                continue;
            }

            $words = preg_split('/\s+/u', $raw) ?: [$raw];
            $family = self::unbrace((string) array_pop($words));

            $names[] = ['family' => $family, 'given' => self::unbrace(implode(' ', $words))];
        }

        return $names;
    }

    /**
     * @param  list<Name>  $names
     */
    public static function serialize(array $names): string
    {
        return implode(' and ', array_map(function (array $name): string {
            $family = trim($name['family']);
            $given = trim($name['given']);

            if ($given === '') {
                // A single token is a corporate author to biblatex only when
                // braced; a lone family name stays a family name.
                return str_contains($family, ' ') ? '{'.$family.'}' : $family;
            }

            return $family.', '.$given;
        }, array_values(array_filter($names, fn (array $name) => trim($name['family']) !== ''))));
    }

    /**
     * The family names, for a label: "Wilamowitz", "Dover and Henderson",
     * "Dover et al.".
     *
     * @param  list<Name>  $names
     */
    public static function familyNames(array $names): string
    {
        $families = array_map(fn (array $name) => $name['family'], $names);

        return match (count($families)) {
            0 => '',
            1 => $families[0],
            2 => $families[0].' and '.$families[1],
            default => $families[0].' et al.',
        };
    }

    /**
     * @return list<string>
     */
    private static function splitOutsideBraces(string $text, string $separator): array
    {
        $parts = [];
        $depth = 0;
        $current = '';
        $length = mb_strlen($text);
        $sepLength = mb_strlen($separator);

        for ($i = 0; $i < $length; $i++) {
            $char = mb_substr($text, $i, 1);

            if ($char === '{') {
                $depth++;
            } elseif ($char === '}') {
                $depth = max(0, $depth - 1);
            }

            if ($depth === 0 && mb_substr($text, $i, $sepLength) === $separator) {
                $parts[] = $current;
                $current = '';
                $i += $sepLength - 1;

                continue;
            }

            $current .= $char;
        }

        $parts[] = $current;

        return $parts;
    }

    private static function unbrace(string $text): string
    {
        return str_replace(['{', '}'], '', $text);
    }
}
