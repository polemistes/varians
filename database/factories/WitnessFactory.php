<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\Witness;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Witness>
 */
class WitnessFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'siglum' => strtoupper(fake()->unique()->lexify('?')),
            'label' => fake()->sentence(4),
        ];
    }
}
