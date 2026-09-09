<?php

namespace Database\Factories;

use App\Models\Edition;
use App\Models\EditionOwnershipTransfer;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EditionOwnershipTransfer>
 */
class EditionOwnershipTransferFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'edition_id' => Edition::factory(),
            'from_user_id' => fn (array $attributes) => Edition::query()->whereKey($attributes['edition_id'])->value('user_id') ?? User::factory(),
            'to_user_id' => User::factory(),
        ];
    }
}
