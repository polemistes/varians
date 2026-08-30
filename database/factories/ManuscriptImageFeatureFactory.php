<?php

namespace Database\Factories;

use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ManuscriptImageFeature>
 */
class ManuscriptImageFeatureFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'manuscript_image_id' => ManuscriptImage::factory(),
            'label' => fake()->randomElement(['Illustration', 'Marginal note', 'Damage', 'Decorated initial']),
            'x' => fake()->randomFloat(6, 0, 0.7),
            'y' => fake()->randomFloat(6, 0, 0.8),
            'width' => fake()->randomFloat(6, 0.05, 0.3),
            'height' => fake()->randomFloat(6, 0.05, 0.3),
        ];
    }
}
