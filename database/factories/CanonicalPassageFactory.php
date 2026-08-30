<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Work;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CanonicalPassage>
 */
class CanonicalPassageFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $book = fake()->numberBetween(1, 24);
        $line = fake()->unique()->numberBetween(1, 999);

        return [
            'work_id' => Work::factory(),
            'address' => ['book' => $book, 'line' => $line],
            'sort_key' => sprintf('%08d.%08d', $book, $line),
            'label' => "{$book}.{$line}",
        ];
    }
}
