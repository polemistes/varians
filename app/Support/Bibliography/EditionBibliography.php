<?php

namespace App\Support\Bibliography;

use App\Models\BibliographyReference;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionPassage;
use Illuminate\Support\Collection;

/**
 * What one edition cites: the items its passages reference, and those
 * referenced by any conjecture placed (as a reading) on one of its
 * passages — the literature its apparatus draws on. The bibliography at
 * the foot of the edition page and the edition's own .bib export both read
 * this.
 */
class EditionBibliography
{
    /**
     * @return Collection<int, int>
     */
    public static function itemIds(Edition $edition): Collection
    {
        $passageIds = EditionPassage::where('edition_id', $edition->id)->pluck('canonical_passage_id');

        $conjectureIds = Conjecture::query()
            ->whereHas('lemmaReadings.lemma', fn ($query) => $query->whereIn('canonical_passage_id', $passageIds))
            ->pluck('id');

        return BibliographyReference::query()
            ->where(fn ($query) => $query
                ->where('edition_id', $edition->id)
                ->orWhereIn('conjecture_id', $conjectureIds))
            ->pluck('bibliography_item_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();
    }
}
