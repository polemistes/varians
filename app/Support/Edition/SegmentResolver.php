<?php

namespace App\Support\Edition;

use App\Models\Segment;
use App\Models\Work;
use Illuminate\Validation\ValidationException;

/**
 * Resolves a work + label into a segment, creating it if it
 * doesn't exist yet. Shared by transcription assignment (a segment backed by
 * an actual manuscript span) and whole-line lacuna authoring (a segment with
 * no manuscript witness at all) — both just need "the segment this label
 * names, creating it on first mention."
 */
class SegmentResolver
{
    public static function resolve(Work $work, string $label): Segment
    {
        $address = $work->referenceScheme->parseLabel($label);

        if ($address === null) {
            throw ValidationException::withMessages([
                'label' => 'That segment label doesn\'t match this work\'s numbering scheme.',
            ]);
        }

        $formatted = $work->referenceScheme->format($address);

        return $work->segments()->firstOrCreate(
            ['sort_key' => $formatted['sort_key']],
            ['address' => $address, 'label' => $formatted['label']],
        );
    }
}
