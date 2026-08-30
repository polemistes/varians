<?php

namespace Database\Factories;

use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ManuscriptImage>
 */
class ManuscriptImageFactory extends Factory
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
            'folio_label' => fake()->numberBetween(1, 200).fake()->randomElement(['r', 'v']),
            'path' => 'manuscript-images/'.fake()->uuid().'.jpg',
            'position' => fake()->unique()->randomFloat(4, 1, 1000),
        ];
    }
}
