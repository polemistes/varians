<?php

namespace App\Support\Edition;

use App\Enums\ConjectureType;
use Illuminate\Validation\Rule;

/**
 * The non-conditional shape every plain conjecture-authoring field takes
 * (substitution/lacuna/supplement — never transposition, which is an
 * edition-ordering proposal authored through its own dedicated request, not
 * this one), regardless of *when* it's required — that depends on context
 * (a bare StoreConjectureRequest vs. one gated behind source=new_conjecture
 * in StoreEditionVariantRequest), so callers layer their own required/
 * required_if/required_unless rules for `text` and
 * `supplements_conjecture_id` on top of these.
 */
class ConjectureValidationRules
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public static function structuralRules(string $prefix): array
    {
        return [
            "{$prefix}type" => ['nullable', Rule::in(array_map(fn (ConjectureType $type) => $type->value, ConjectureType::cases()))],
            "{$prefix}text" => ['nullable', 'string', 'max:255'],
            "{$prefix}extent" => ['nullable', 'string', 'max:255'],
            "{$prefix}extent_characters" => ['nullable', 'integer', 'min:0'],
            "{$prefix}supplements_conjecture_id" => ['nullable', Rule::exists('conjectures', 'id')->where('type', ConjectureType::Lacuna->value)],
        ];
    }
}
