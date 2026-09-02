<?php

namespace Database\Factories;

use App\Models\ManuscriptPage;
use App\Models\Witness;
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
            'witness_id' => Witness::factory(),
            'label' => fake()->numberBetween(1, 200).fake()->randomElement(['r', 'v']),
            'position' => fake()->randomFloat(2, 1, 500),
        ];
    }
}
