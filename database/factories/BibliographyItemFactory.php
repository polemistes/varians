<?php

namespace Database\Factories;

use App\Models\BibliographyItem;
use App\Models\User;
use App\Support\Bibliography\CitationLabel;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BibliographyItem>
 */
class BibliographyItemFactory extends Factory
{
    /**
     * A book by one author, the commonest shape. The label is derived the
     * way the controller derives it, so a factory item reads like a real
     * one ("Bergk 1882").
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $family = fake()->unique()->lastName();
        $year = (string) fake()->numberBetween(1800, 2025);
        $fields = [
            'author' => $family.', '.fake()->firstName(),
            'title' => fake()->sentence(4),
            'publisher' => fake()->company(),
            'location' => fake()->city(),
            'date' => $year,
        ];

        return [
            'entry_type' => 'book',
            'citation_key' => strtolower(preg_replace('/[^a-z]/i', '', $family)).$year.fake()->unique()->numberBetween(1, 99999),
            'fields' => $fields,
            'label' => CitationLabel::base('book', $fields),
            'user_id' => User::factory(),
        ];
    }

    /**
     * A journal article.
     */
    public function article(): static
    {
        return $this->state(fn (array $attributes) => [
            'entry_type' => 'article',
            'fields' => [
                'author' => $attributes['fields']['author'],
                'title' => $attributes['fields']['title'],
                'journaltitle' => 'Classical Quarterly',
                'date' => $attributes['fields']['date'],
                'volume' => (string) fake()->numberBetween(1, 70),
                'pages' => '45--67',
            ],
        ]);
    }
}
