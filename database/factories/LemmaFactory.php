<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Lemma;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Lemma>
 */
class LemmaFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'canonical_passage_id' => CanonicalPassage::factory(),
            'position' => fake()->unique()->randomFloat(4, 1, 1000),
        ];
    }
}
