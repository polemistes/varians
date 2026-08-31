<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionComment>
 */
class EditionCommentFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * Unanchored by default — a note about the passage as a whole, which is
     * the simpler and commoner case. Use `onLemma()` to pin one to a column.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'edition_id' => Edition::factory(),
            'canonical_passage_id' => CanonicalPassage::factory(),
            'lemma_id' => null,
            'range_end_lemma_id' => null,
            'user_id' => User::factory(),
            'note' => fake()->sentence(),
        ];
    }
}
