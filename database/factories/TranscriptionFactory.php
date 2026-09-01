<?php

namespace Database\Factories;

use App\Enums\Visibility;
use App\Models\Transcription;
use App\Models\Witness;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Transcription>
 */
class TranscriptionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'witness_id' => Witness::factory(),
            'name' => 'Transcription',
            'position' => 1,
        ];
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes) => [
            'visibility' => Visibility::Published,
        ]);
    }

    /**
     * Both layers at once, which is what a transcription always has outside
     * the moment of creation.
     */
    public function withLayers(): static
    {
        return $this->afterCreating(function (Transcription $transcription) {
            TranscriptionLayerFactory::new()->diplomatic()->create(['transcription_id' => $transcription->id]);
            TranscriptionLayerFactory::new()->normalized()->create(['transcription_id' => $transcription->id]);
        });
    }
}
