<?php

use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\User;

test('a non-textual feature can be marked on a manuscript image', function () {
    $this->actingAs(User::factory()->editor()->create());
    $image = ManuscriptImage::factory()->create();

    $response = $this->post(route('manuscript-image-features.store', $image), [
        'label' => 'Illustration',
        'x' => 0.1,
        'y' => 0.2,
        'width' => 0.3,
        'height' => 0.15,
    ]);

    $response->assertRedirect();

    $feature = $image->features()->sole();
    expect($feature->label)->toBe('Illustration')
        ->and((float) $feature->width)->toBe(0.3);
});

test('a feature can be removed', function () {
    $this->actingAs(User::factory()->editor()->create());
    $feature = ManuscriptImageFeature::factory()->create();

    $response = $this->delete(route('manuscript-image-features.destroy', $feature));

    $response->assertRedirect();
    expect(ManuscriptImageFeature::find($feature->id))->toBeNull();
});
