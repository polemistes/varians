<?php

namespace Database\Factories;

use App\Models\Conjecture;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\TranscriptionLayer;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<LemmaReading>
 */
class LemmaReadingFactory extends Factory
{
    /**
     * Define the model's default state — a transcription-sourced reading.
     * Use the conjecture() state for a free-text one.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $word = fake()->word();

        return [
            'lemma_id' => Lemma::factory(),
            'transcription_layer_id' => TranscriptionLayer::factory(['text' => $word]),
            'start_offset' => 0,
            'end_offset' => mb_strlen($word),
            'conjecture_id' => null,
        ];
    }

    public function conjecture(): static
    {
        return $this->state(fn (array $attributes) => [
            'transcription_layer_id' => null,
            'start_offset' => null,
            'end_offset' => null,
            'conjecture_id' => Conjecture::factory(),
        ]);
    }
}
