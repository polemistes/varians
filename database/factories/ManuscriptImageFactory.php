<?php

namespace Database\Factories;

use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptPage;
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
            'manuscript_id' => Manuscript::factory(),
            // The page belongs to the same manuscript as the image: an image
            // is a photograph of one of its own manuscript's pages, and a
            // factory that made two unrelated manuscripts would quietly
            // produce impossible data.
            'manuscript_page_id' => fn (array $attributes) => ManuscriptPage::factory()
                ->create(['manuscript_id' => $attributes['manuscript_id']])->id,
            'path' => 'manuscript-images/'.fake()->uuid().'.jpg',
            'position' => fake()->unique()->randomFloat(4, 1, 1000),
        ];
    }
}
