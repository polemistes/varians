<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionPassageOrder;
use App\Models\Transcription;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionPassageOrder>
 */
class EditionPassageOrderFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * Defaults to a transcription-sourced choice — see `conjectureSourced()`
     * for the alternative.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'edition_id' => Edition::factory(),
            'range_start_canonical_passage_id' => CanonicalPassage::factory(),
            'range_end_canonical_passage_id' => CanonicalPassage::factory(),
            'transcription_id' => Transcription::factory(),
            'conjecture_id' => null,
            'user_id' => User::factory(),
        ];
    }

    /**
     * A choice sourced from a catalogued Reordering conjecture instead of a
     * transcription.
     */
    public function conjectureSourced(): static
    {
        return $this->state(fn (array $attributes) => [
            'transcription_id' => null,
            'conjecture_id' => Conjecture::factory()->reordering(),
        ]);
    }
}
