<?php

namespace Database\Factories;

use App\Enums\WitnessType;
use App\Models\Manuscript;
use App\Models\Witness;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Manuscript>
 */
class ManuscriptFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'witness_id' => Witness::factory()->state(['type' => WitnessType::Manuscript]),
            'repository' => fake()->company().' Library',
            'shelfmark' => strtoupper(fake()->bothify('gr. ###')),
            'date_text' => 's. '.fake()->randomElement(['X', 'XI', 'XII', 'XIII', 'XIV']),
            'notes' => fake()->optional()->sentence(),
        ];
    }
}
