<?php

namespace App\Support\Bibliography;

use Illuminate\Validation\Rule;

/**
 * The validation rules for a list of citations travelling with the thing
 * they cite — a new conjecture or order proposal sends its references in
 * the same request, so nothing is ever recorded without its literature.
 * Shared by every form request that creates a conjecture; `$prefix` is the
 * field name the request uses (`references`, `conjecture_references`).
 */
class ReferenceRules
{
    /**
     * @return array<string, array<mixed>>
     */
    public static function rules(string $field): array
    {
        return [
            $field => ['sometimes', 'array'],
            $field.'.*.item_id' => ['required', 'integer', Rule::exists('bibliography_items', 'id')],
            $field.'.*.prenote' => ['nullable', 'string', 'max:255'],
            $field.'.*.postnote' => ['nullable', 'string', 'max:255'],
        ];
    }
}
