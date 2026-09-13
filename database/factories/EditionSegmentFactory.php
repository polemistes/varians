<?php

namespace Database\Factories;

use App\Models\Edition;
use App\Models\EditionSegment;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionSegment>
 */
class EditionSegmentFactory extends Factory
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
            'segment_id' => Segment::factory(),
            'transcription_layer_id' => TranscriptionLayer::factory(),
            'position' => fake()->unique()->randomFloat(4, 1, 1000),
        ];
    }
}
