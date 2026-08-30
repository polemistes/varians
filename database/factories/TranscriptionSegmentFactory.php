<?php

namespace Database\Factories;

use App\Models\CanonicalPassage;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<TranscriptionSegment>
 */
class TranscriptionSegmentFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'transcription_id' => Transcription::factory(),
            'canonical_passage_id' => CanonicalPassage::factory(),
            'start_offset' => 0,
            'end_offset' => 1,
            'needs_review' => false,
        ];
    }
}
