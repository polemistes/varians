<?php

namespace Database\Factories;

use App\Models\Manuscript;
use App\Models\ManuscriptPage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ManuscriptPage>
 */
class ManuscriptPageFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'manuscript_id' => Manuscript::factory(),
            'label' => fake()->numberBetween(1, 200).fake()->randomElement(['r', 'v']),
            'position' => fake()->randomFloat(2, 1, 500),
        ];
    }
}
