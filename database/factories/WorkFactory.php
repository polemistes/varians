<?php

namespace Database\Factories;

use App\Models\ReferenceScheme;
use App\Models\Work;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Work>
 */
class WorkFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $title = fake()->unique()->sentence(3);

        return [
            'reference_scheme_id' => ReferenceScheme::factory(),
            'title' => $title,
            'author' => fake()->name(),
            'language' => fake()->randomElement(['grc', 'lat']),
            'slug' => Str::slug($title),
        ];
    }
}
