<?php

namespace Database\Factories;

use App\Enums\TranscriptionLayer;
use App\Enums\Visibility;
use App\Models\Transcription;
use App\Models\User;
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
            'user_id' => User::factory(),
            'forked_from_id' => null,
            // Normalized by default so a plain factory transcription is
            // collatable — the overwhelmingly common need in tests, and what
            // every transcription effectively was before the layer existed.
            'layer' => TranscriptionLayer::Normalized,
            'text' => fake()->paragraph(),
            'visibility' => Visibility::Draft,
        ];
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes) => [
            'visibility' => Visibility::Published,
        ]);
    }

    public function diplomatic(): static
    {
        return $this->state(fn (array $attributes) => [
            'layer' => TranscriptionLayer::Diplomatic,
        ]);
    }

    public function normalized(): static
    {
        return $this->state(fn (array $attributes) => [
            'layer' => TranscriptionLayer::Normalized,
        ]);
    }
}
