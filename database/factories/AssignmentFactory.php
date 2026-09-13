<?php

namespace Database\Factories;

use App\Models\Assignment;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Assignment>
 */
class AssignmentFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'transcription_layer_id' => TranscriptionLayer::factory(),
            'segment_id' => Segment::factory(),
            'start_offset' => 0,
            'end_offset' => 1,
            'needs_review' => false,
        ];
    }
}
