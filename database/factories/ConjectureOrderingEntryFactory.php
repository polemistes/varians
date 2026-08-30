<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ConjectureOrderingEntry>
 */
class ConjectureOrderingEntryFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'conjecture_id' => Conjecture::factory()->reordering(),
            'canonical_passage_id' => CanonicalPassage::factory(),
            'sequence' => 0,
        ];
    }
}
