<?php

use App\Models\Witness;
use App\Models\Work;
use Database\Seeders\ScholarlyEditionSeeder;
use Illuminate\Support\Facades\Storage;

test('the sample data leaves nothing ownerless', function () {
    Storage::fake('public');

    $this->seed(ScholarlyEditionSeeder::class);

    expect(Work::count())->toBeGreaterThan(0)
        ->and(Work::whereNull('user_id')->exists())->toBeFalse()
        ->and(Witness::whereNull('user_id')->exists())->toBeFalse();
});
