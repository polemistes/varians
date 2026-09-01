<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\TranscriptionLayer;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionPassage>
 */
class EditionPassageFactory extends Factory
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
            'canonical_passage_id' => CanonicalPassage::factory(),
            'transcription_layer_id' => TranscriptionLayer::factory(),
            'position' => fake()->unique()->randomFloat(4, 1, 1000),
        ];
    }
}
