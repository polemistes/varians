<?php

namespace App\Http\Requests;

use App\Models\BibliographyItem;
use Illuminate\Validation\Rule;

class UpdateBibliographyItemRequest extends StoreBibliographyItemRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var BibliographyItem $item */
        $item = $this->route('item');

        return $this->user()->can('update', $item);
    }

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
