<?php

namespace App\Support\Bibliography;

/**
 * The short author–year form an apparatus cites by: "Wilamowitz 1927",
 * "Dover and Henderson 1987", "Henderson 1987b". The names come from the
 * first name list the entry carries (author, then editor, then translator,
 * then a corporate body), the year from `date` (its leading year) or
 * `year`; an entry with neither names nor a year falls back to its title.
 */
class CitationLabel
{
    /**
     * @param  array<string, mixed>  $fields
     */
    public static function base(string $entryType, array $fields): string
    {
        $names = '';

        foreach (['author', 'editor', 'translator'] as $nameField) {
            $value = $fields[$nameField] ?? null;

            if (is_string($value) && trim($value) !== '') {
                $names = NameList::familyNames(NameList::parse($value));

                break;
            }
        }

        if ($names === '') {
            foreach (['organization', 'institution', 'publisher'] as $bodyField) {
                $value = $fields[$bodyField] ?? null;

                if (is_string($value) && trim($value) !== '') {
                    $names = trim(explode(' and ', $value)[0]);

                    break;
                }
            }
        }

        $year = self::year($fields);

        if ($names === '' && $year === '') {
            $title = $fields['shorttitle'] ?? $fields['title'] ?? $entryType;

            return is_string($title) && trim($title) !== '' ? trim($title) : $entryType;
        }

        if ($names === '') {
            $title = $fields['shorttitle'] ?? $fields['title'] ?? null;

            return trim((is_string($title) ? $title.' ' : '').$year);
        }

        return trim($names.' '.$year);
    }

    /**
     * The year an entry is cited by — the leading year of `date`
     * ("1927-05", "1927/1930" and "1927~" all give 1927), else `year`.
     *
     * @param  array<string, mixed>  $fields
     */
    public static function year(array $fields): string
    {
        foreach (['date', 'year'] as $field) {
            $value = $fields[$field] ?? null;

            if (is_string($value) && preg_match('/\d{4}/', $value, $match) === 1) {
                return $match[0];
            }
        }

        return '';
    }

    /**
     * Give a base label the suffix that keeps it apart from the labels
     * already taken: "Henderson 1987" beside an existing "Henderson 1987"
     * becomes "Henderson 1987a"; the next "Henderson 1987b".
     *
     * @param  list<string>  $taken
     */
    public static function disambiguate(string $base, array $taken): string
    {
        if (! in_array($base, $taken, true)) {
            return $base;
        }

        foreach (range('a', 'z') as $suffix) {
            if (! in_array($base.$suffix, $taken, true)) {
                return $base.$suffix;
            }
        }

        return $base.count($taken);
    }
}
