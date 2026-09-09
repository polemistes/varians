<?php

namespace App\Support\Bibliography;

use App\Models\BibliographyReference;
use App\Models\Conjecture;

/**
 * Records the citations a newly created conjecture arrived with, in the
 * order given. Pairs with ReferenceRules: the request validated the item
 * ids, this writes the rows.
 */
class ReferenceAttacher
{
    /**
     * @param  list<array{item_id: int|string, prenote?: string|null, postnote?: string|null}>|null  $references
     */
    public static function toConjecture(Conjecture $conjecture, ?array $references): void
    {
        foreach ($references ?? [] as $position => $reference) {
            BibliographyReference::create([
                'bibliography_item_id' => (int) $reference['item_id'],
                'conjecture_id' => $conjecture->id,
                'prenote' => self::text($reference['prenote'] ?? null),
                'postnote' => self::text($reference['postnote'] ?? null),
                'position' => $position,
            ]);
        }
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
