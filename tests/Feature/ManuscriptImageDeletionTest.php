<?php

use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;

test('deleting a manuscript image cascades its features and regions, leaving the parent transcription untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $image = ManuscriptImage::factory()->create();
    $feature = ManuscriptImageFeature::factory()->for($image, 'manuscriptImage')->create();
    $transcription = Transcription::factory()->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();

    $response = $this->from(route('witnesses.show', $transcription->witness))
        ->delete(route('manuscript-images.destroy', $image));

    $response->assertRedirect(route('witnesses.show', $transcription->witness));
    expect(ManuscriptImage::find($image->id))->toBeNull()
        ->and(ManuscriptImageFeature::find($feature->id))->toBeNull()
        ->and(TranscriptionRegion::find($region->id))->toBeNull()
        ->and(Transcription::find($transcription->id))->not->toBeNull()
        ->and(TranscriptionSegment::find($segment->id))->not->toBeNull();
});
