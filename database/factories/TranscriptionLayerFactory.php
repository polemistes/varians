<?php

namespace Database\Factories;

use App\Enums\Layer;
use App\Enums\Visibility;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Model;

/**
 * @extends Factory<TranscriptionLayer>
 */
class TranscriptionLayerFactory extends Factory
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
            'user_id' => User::factory(),
            'copied_from_id' => null,
            // Normalized by default so a plain factory transcription is
            // collatable — the overwhelmingly common need in tests, and what
            // every transcription effectively was before the layer existed.
            'layer' => Layer::Normalized,
            'text' => fake()->paragraph(),
        ];
    }

    /**
     * A layer reaches its witness through its parent transcription, so
     * `->for($witness)` is taken to mean "a layer of a transcription of this
     * witness" rather than failing on a relation that is no longer a
     * BelongsTo. Kept because that is what a test saying `->for($witness)`
     * has always meant, and rewriting every call site would have meant
     * editing the safety net during the refactor it was there to catch.
     *
     * @param  Factory<covariant \Illuminate\Database\Eloquent\Model>|Model  $factory
     */
    public function for($factory, $relationship = null): static
    {
        $isWitness = $factory instanceof Witness
            || ($factory instanceof Factory && $factory->modelName() === Witness::class);

        if ($isWitness && ($relationship === null || $relationship === 'witness')) {
            return parent::for(Transcription::factory()->for($factory), 'transcription');
        }

        return parent::for($factory, $relationship);
    }

    /**
     * Publishing a layer publishes its transcription, which is what
     * publishing now means: a transcription is public or it is not, and if it
     * is, both of its layers are. Kept under this name so that the many tests
     * saying `->published()` on a layer keep saying what they meant.
     */
    public function published(): static
    {
        return $this->afterCreating(
            fn (TranscriptionLayer $layer) => $layer->transcription->update(['visibility' => Visibility::Published]),
        );
    }

    public function diplomatic(): static
    {
        return $this->state(fn (array $attributes) => [
            'layer' => Layer::Diplomatic,
        ]);
    }

    public function normalized(): static
    {
        return $this->state(fn (array $attributes) => [
            'layer' => Layer::Normalized,
        ]);
    }
}
