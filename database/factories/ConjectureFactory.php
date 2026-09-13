<?php

namespace Database\Factories;

use App\Enums\ConjectureType;
use App\Models\Conjecture;
use App\Models\Segment;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Conjecture>
 */
class ConjectureFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'segment_id' => Segment::factory(),
            'user_id' => User::factory(),
            'type' => ConjectureType::Substitution,
            'text' => fake()->words(3, true),
            'proposed_by' => fake()->optional()->lastName(),
            'note' => fake()->optional()->sentence(),
        ];
    }

    /**
     * Text believed lost here — a pure insertion, never a competing
     * candidate for an existing word. `text` is always null; a proposed
     * restoration is a separate Supplement (see `supplement()`).
     */
    public function lacuna(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => ConjectureType::Lacuna,
            'text' => null,
            'extent' => fake()->randomElement(['one line', 'c. 5 letters', 'two words']),
        ]);
    }

    /**
     * A proposed restoration for a specific Lacuna — several, from
     * different proposers, can target the same one.
     */
    public function supplement(Conjecture $lacuna): static
    {
        return $this->state(fn (array $attributes) => [
            'segment_id' => $lacuna->segment_id,
            'type' => ConjectureType::Supplement,
            'supplements_conjecture_id' => $lacuna->id,
        ]);
    }

    /**
     * A proposal that this segment (or, with a range end passed in) a range
     * of segments should be read moved before/after another segment —
     * changes edition ordering, not wording.
     */
    public function transposition(?Segment $rangeEnd = null): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => ConjectureType::Transposition,
            'text' => null,
            'transposition_range_end_segment_id' => $rangeEnd?->id,
            'move_target_segment_id' => Segment::factory(),
            'move_position' => fake()->randomElement(['before', 'after']),
        ]);
    }

    /**
     * A proposed *internal* sequence for a fixed set of segments — never
     * moved anywhere, see ConjectureOrderingEntry for the actual
     * set-and-sequence. Bare here (no entries) since callers almost always
     * need to control the sequence explicitly — see
     * ConjectureOrderingEntryFactory.
     */
    public function reordering(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => ConjectureType::Reordering,
            'text' => null,
        ]);
    }
}
