<?php

namespace Database\Factories;

use App\Enums\ParatextKind;
use App\Models\Edition;
use App\Models\EditionParatext;
use App\Models\Lemma;
use App\Models\Segment;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionParatext>
 */
class EditionParatextFactory extends Factory
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
            'segment_id' => Segment::factory(),
            'lemma_id' => Lemma::factory(),
            'placement' => 'before',
            'kind' => ParatextKind::Inline,
            'text' => fake()->words(2, true),
            'position' => 1,
        ];
    }
}
