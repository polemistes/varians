<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLineBreak;
use App\Models\Lemma;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionLineBreak>
 */
class EditionLineBreakFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'edition_id' => Edition::factory(),
            'canonical_passage_id' => CanonicalPassage::factory(),
            'lemma_id' => Lemma::factory(),
            'kind' => 'line',
        ];
    }
}
