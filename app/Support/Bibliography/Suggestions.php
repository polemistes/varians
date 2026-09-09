<?php

namespace App\Support\Bibliography;

use App\Models\BibliographyItem;

/**
 * What the list already says, offered back while typing: the names,
 * publishers, journals, places and series recorded on existing items, so
 * a second entry for the same author or press is spelled the way the
 * first was. Suggestions only — nothing is enforced, since a new name or
 * press is exactly what a new item may need (user decision: standardize
 * by nudging, not by refusing).
 *
 * @phpstan-type SuggestionLists array{names: list<array{family: string, given: string}>, publisher: list<string>, journaltitle: list<string>, location: list<string>, series: list<string>}
 */
class Suggestions
{
    /** The literal-list fields whose values are offered, each split on "and". */
    private const LIST_FIELDS = ['publisher', 'location'];

    /** The single-value fields whose values are offered whole. */
    private const LITERAL_FIELDS = ['journaltitle', 'series'];

    /**
     * @return SuggestionLists
     */
    public static function all(): array
    {
        $names = [];
        $values = ['publisher' => [], 'journaltitle' => [], 'location' => [], 'series' => []];

        foreach (BibliographyItem::query()->pluck('fields') as $fields) {
            if (! is_array($fields)) {
                continue;
            }

            foreach ($fields as $field => $value) {
                if (! is_string($value) || trim($value) === '') {
                    continue;
                }

                if (Biblatex::kind((string) $field) === 'name') {
                    foreach (NameList::parse($value) as $name) {
                        $names[mb_strtolower($name['family'].'|'.$name['given'])] = $name;
                    }
                } elseif (in_array($field, self::LIST_FIELDS, true)) {
                    foreach (explode(' and ', $value) as $part) {
                        $values[$field][mb_strtolower(trim($part))] = trim($part);
                    }
                } elseif (in_array($field, self::LITERAL_FIELDS, true)) {
                    $values[$field][mb_strtolower(trim($value))] = trim($value);
                }
            }
        }

        $sortedNames = array_values($names);
        usort($sortedNames, fn (array $a, array $b) => [$a['family'], $a['given']] <=> [$b['family'], $b['given']]);

        /**
         * @param  array<string, string>  $list
         * @return list<string>
         */
        $sorted = function (array $list): array {
            $values = array_values($list);
            sort($values, SORT_NATURAL | SORT_FLAG_CASE);

            return $values;
        };

        return [
            'names' => $sortedNames,
            'publisher' => $sorted($values['publisher']),
            'journaltitle' => $sorted($values['journaltitle']),
            'location' => $sorted($values['location']),
            'series' => $sorted($values['series']),
        ];
    }
}
