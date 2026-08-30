<?php

namespace Database\Factories;

use App\Models\ReferenceScheme;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ReferenceScheme>
 */
class ReferenceSchemeFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'Book and line numbering',
            'levels' => [
                ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => ''],
                ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => '.'],
            ],
        ];
    }

    /**
     * A Stephanus-pagination scheme, as used for Plato.
     */
    public function stephanus(): static
    {
        return $this->state(fn (array $attributes) => [
            'name' => 'Stephanus pagination',
            'levels' => [
                ['key' => 'page', 'label' => 'Page', 'type' => 'integer', 'separator' => ''],
                ['key' => 'section', 'label' => 'Section', 'type' => 'string', 'separator' => ''],
            ],
        ]);
    }
}
