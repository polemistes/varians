<?php

namespace App\Support\Edition;

use App\Models\CanonicalPassage;
use App\Models\Work;
use Illuminate\Validation\ValidationException;

/**
 * Resolves a work + label into a canonical passage, creating it if it
 * doesn't exist yet. Shared by transcription citation (a passage backed by
 * an actual manuscript span) and whole-line lacuna authoring (a passage with
 * no manuscript witness at all) — both just need "the passage this label
 * names, creating it on first mention."
 */
class CanonicalPassageResolver
{
    public static function resolve(Work $work, string $label): CanonicalPassage
    {
        $address = $work->referenceScheme->parseLabel($label);

        if ($address === null) {
            throw ValidationException::withMessages([
                'label' => 'That citation doesn\'t match this work\'s numbering scheme.',
            ]);
        }

        $formatted = $work->referenceScheme->format($address);

        return $work->canonicalPassages()->firstOrCreate(
            ['sort_key' => $formatted['sort_key']],
            ['address' => $address, 'label' => $formatted['label']],
        );
    }
}
