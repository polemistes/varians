<?php

use App\Models\Assignment;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\User;

test('deleting a manuscript image cascades its features and regions, leaving the parent transcription untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $image = ManuscriptImage::factory()->create();
    $feature = ManuscriptImageFeature::factory()->for($image, 'manuscriptImage')->create();
    $transcription = TranscriptionLayer::factory()->create();
    $assignment = Assignment::factory()->for($transcription)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();

    $response = $this->from(route('witnesses.show', $transcription->witness))
        ->delete(route('manuscript-images.destroy', $image));

    $response->assertRedirect(route('witnesses.show', $transcription->witness));
    expect(ManuscriptImage::find($image->id))->toBeNull()
        ->and(ManuscriptImageFeature::find($feature->id))->toBeNull()
        ->and(TranscriptionRegion::find($region->id))->toBeNull()
        ->and(TranscriptionLayer::find($transcription->id))->not->toBeNull()
        ->and(Assignment::find($assignment->id))->not->toBeNull();
});
