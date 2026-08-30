<?php

namespace Database\Factories;

use App\Models\ManuscriptImage;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<TranscriptionRegion>
 */
class TranscriptionRegionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $word = fake()->word();

        return [
            'transcription_id' => Transcription::factory(),
            'manuscript_image_id' => ManuscriptImage::factory(),
            'text' => $word,
            'start_offset' => 0,
            'end_offset' => mb_strlen($word),
            'position' => fake()->unique()->randomFloat(4, 1, 1000),
            'x' => fake()->randomFloat(6, 0, 0.7),
            'y' => fake()->randomFloat(6, 0, 0.8),
            'width' => fake()->randomFloat(6, 0.05, 0.3),
            'height' => fake()->randomFloat(6, 0.02, 0.15),
            'needs_review' => false,
        ];
    }
}
