<?php

namespace Database\Factories;

use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\Segment;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BibliographyReference>
 */
class BibliographyReferenceFactory extends Factory
{
    /**
     * A conjecture citing an item by default; `onSegment()` cites from a
     * segment of an edition instead.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'bibliography_item_id' => BibliographyItem::factory(),
            'conjecture_id' => Conjecture::factory(),
            'edition_id' => null,
            'segment_id' => null,
            'prenote' => null,
            'postnote' => null,
            'position' => 0,
        ];
    }

    public function onSegment(Edition $edition, Segment $segment): static
    {
        return $this->state(fn () => [
            'conjecture_id' => null,
            'edition_id' => $edition->id,
            'segment_id' => $segment->id,
        ]);
    }
}
