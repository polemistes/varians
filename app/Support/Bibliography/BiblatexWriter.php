<?php

namespace App\Support\Bibliography;

use App\Models\BibliographyItem;
use Illuminate\Support\Collection;

/**
 * Writes items as biblatex entries — the export the whole list exists to
 * make possible. Fields come out in the registry's order, values braced;
 * a closing brace inside a value is escaped by the balance biblatex
 * expects, which is to say values are written as they were stored, since
 * the form never lets an unbalanced brace in.
 */
class BiblatexWriter
{
    public static function entry(BibliographyItem $item): string
    {
        $lines = [];

        foreach (Biblatex::fieldNames() as $name) {
            $value = $item->field($name);

            if ($value === null) {
                continue;
            }

            $lines[] = '  '.$name.' = {'.$value.'}';
        }

        return '@'.$item->entry_type.'{'.$item->citation_key.",\n".implode(",\n", $lines)."\n}";
    }

    /**
     * @param  Collection<int, BibliographyItem>  $items
     */
    public static function file(Collection $items): string
    {
        return $items
            ->sortBy('citation_key')
            ->map(fn (BibliographyItem $item) => self::entry($item))
            ->join("\n\n")."\n";
    }
}
