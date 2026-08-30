<?php

namespace Database\Factories;

use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionTransposition;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionTransposition>
 */
class EditionTranspositionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'edition_id' => Edition::factory(),
            'conjecture_id' => Conjecture::factory()->transposition(),
        ];
    }
}
