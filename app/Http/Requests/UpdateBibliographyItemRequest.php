<?php

namespace App\Http\Requests;

use App\Models\BibliographyItem;
use Illuminate\Validation\Rule;

class UpdateBibliographyItemRequest extends StoreBibliographyItemRequest
{
    /**
     * The same entry rules as for a new item; the key stays unique among
     * the OTHER items.
     */
    protected function uniqueKey(): mixed
    {
        /** @var BibliographyItem $item */
        $item = $this->route('item');

        return Rule::unique('bibliography_items', 'citation_key')->ignore($item->id);
    }
}
