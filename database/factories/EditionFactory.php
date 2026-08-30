<?php

namespace Database\Factories;

use App\Enums\Visibility;
use App\Models\Edition;
use App\Models\User;
use App\Models\Work;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Edition>
 */
class EditionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'work_id' => Work::factory(),
            'user_id' => User::factory(),
            'title' => fake()->unique()->sentence(3),
            'description' => fake()->optional()->paragraph(),
            'visibility' => Visibility::Draft,
        ];
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes) => [
            'visibility' => Visibility::Published,
        ]);
    }
}
