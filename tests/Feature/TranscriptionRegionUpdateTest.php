<?php

use App\Models\TranscriptionRegion;
use App\Models\User;

test('a region can be moved and resized', function () {
    $this->actingAs(User::factory()->editor()->create());
    $region = TranscriptionRegion::factory()->create([
        'x' => 0.1, 'y' => 0.1, 'width' => 0.1, 'height' => 0.05,
    ]);

    $response = $this->patch(route('transcription-regions.update', $region), [
        'x' => 0.2, 'y' => 0.25, 'width' => 0.15, 'height' => 0.07,
    ]);

    $response->assertRedirect();

    $region->refresh();
    expect((float) $region->x)->toBe(0.2)
        ->and((float) $region->y)->toBe(0.25)
        ->and((float) $region->width)->toBe(0.15)
        ->and((float) $region->height)->toBe(0.07);
});

test('moving a region clears its needs_review flag', function () {
    $this->actingAs(User::factory()->editor()->create());
    $region = TranscriptionRegion::factory()->create(['needs_review' => true]);

    $this->patch(route('transcription-regions.update', $region), [
        'x' => 0.2, 'y' => 0.2, 'width' => 0.1, 'height' => 0.1,
    ]);

    expect($region->fresh()->needs_review)->toBeFalse();
});

test('a region cannot be moved outside the image bounds', function () {
    $this->actingAs(User::factory()->editor()->create());
    $region = TranscriptionRegion::factory()->create();

    $response = $this->patch(route('transcription-regions.update', $region), [
        'x' => 1.2, 'y' => 0.1, 'width' => 0.1, 'height' => 0.1,
    ]);

    $response->assertInvalid(['x']);
});
