<?php

namespace Database\Factories;

use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionLemma>
 */
class EditionLemmaFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * `selected_reading_id` must belong to `lemma_id` — created together
     * here (rather than via two independent nested factories) since the two
     * are correlated, not incidental.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $lemma = Lemma::factory()->create();

        return [
            'edition_id' => Edition::factory(),
            'lemma_id' => $lemma->id,
            'selected_reading_id' => LemmaReading::factory()->for($lemma)->create()->id,
        ];
    }
}
