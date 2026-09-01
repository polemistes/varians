<?php

namespace Database\Factories;

use App\Models\ManuscriptPage;
use App\Models\Transcription;
use App\Models\TranscriptionPageBreak;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<TranscriptionPageBreak>
 */
class TranscriptionPageBreakFactory extends Factory
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
            'manuscript_page_id' => ManuscriptPage::factory(),
            'start_line' => 0,
        ];
    }
}
