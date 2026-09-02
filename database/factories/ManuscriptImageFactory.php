<?php

namespace Database\Factories;

use App\Models\ManuscriptImage;
use App\Models\ManuscriptPage;
use App\Models\Witness;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ManuscriptImage>
 */
class ManuscriptImageFactory extends Factory
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
            // The page belongs to the same witness as the image: an image
            // is a photograph of one of its own witness's pages, and a
            // factory that made two unrelated witnesses would quietly
            // produce impossible data.
            'manuscript_page_id' => fn (array $attributes) => ManuscriptPage::factory()
                ->create(['witness_id' => $attributes['witness_id']])->id,
            'path' => 'manuscript-images/'.fake()->uuid().'.jpg',
            'position' => fake()->unique()->randomFloat(4, 1, 1000),
        ];
    }
}
