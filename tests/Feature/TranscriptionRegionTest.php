<?php

use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\User;
use App\Models\Witness;

function makeTranscriptionWithImage(): array
{
    $witness = Witness::factory()->create();
    $image = ManuscriptImage::factory()->for($witness)->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create(['text' => 'λόγος καλός ἐστιν']);

    return [$transcription, $image];
}

test('a region can be attached to a transcription and an image', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImage();

    $response = $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $image->id,
        'text' => 'λόγος',
        'start_offset' => 0,
        'end_offset' => 5,
        'x' => 0.1,
        'y' => 0.2,
        'width' => 0.1,
        'height' => 0.05,
    ]);

    $response->assertRedirect();

    $region = $transcription->regions()->sole();

    expect($region->text)->toBe('λόγος')
        ->and($region->manuscript_image_id)->toBe($image->id)
        ->and($region->start_offset)->toBe(0)
        ->and($region->end_offset)->toBe(5)
        ->and((float) $region->position)->toBe(1.0)
        ->and($region->needs_review)->toBeFalse();
});

test('regions are appended in position order', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImage();

    $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $image->id,
        'text' => 'λόγος',
        'start_offset' => 0,
        'end_offset' => 5,
        'x' => 0.1,
        'y' => 0.1,
        'width' => 0.1,
        'height' => 0.05,
    ]);

    $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $image->id,
        'text' => 'καλός',
        'start_offset' => 6,
        'end_offset' => 11,
        'x' => 0.3,
        'y' => 0.1,
        'width' => 0.1,
        'height' => 0.05,
    ]);

    expect($transcription->regions()->orderBy('position')->pluck('text')->all())
        ->toBe(['λόγος', 'καλός']);
});

test('a region cannot reference an image from another manuscript', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription] = makeTranscriptionWithImage();
    $otherImage = ManuscriptImage::factory()->create();

    $response = $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $otherImage->id,
        'text' => 'λόγος',
        'start_offset' => 0,
        'end_offset' => 5,
        'x' => 0.1,
        'y' => 0.1,
        'width' => 0.1,
        'height' => 0.05,
    ]);

    $response->assertInvalid(['manuscript_image_id']);
});

test('a region cannot extend past the end of the transcription text', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImage();

    $response = $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $image->id,
        'text' => 'overflow',
        'start_offset' => 0,
        'end_offset' => 999,
        'x' => 0.1,
        'y' => 0.1,
        'width' => 0.1,
        'height' => 0.05,
    ]);

    $response->assertInvalid(['end_offset']);
});

test('a region can be removed', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImage();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();

    $response = $this->delete(route('transcription-regions.destroy', $region));

    $response->assertRedirect();
    expect(TranscriptionRegion::find($region->id))->toBeNull();
});

test('text already mapped to the facsimile cannot be mapped again', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImage();

    $box = ['x' => 0.1, 'y' => 0.2, 'width' => 0.1, 'height' => 0.05];
    $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $image->id,
        'text' => 'λόγος',
        'start_offset' => 0,
        'end_offset' => 5,
        ...$box,
    ])->assertRedirect();

    // Overlapping the existing mapping — single and batch alike.
    $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $image->id,
        'text' => 'ος κα',
        'start_offset' => 3,
        'end_offset' => 8,
        ...$box,
    ])->assertInvalid(['start_offset']);

    $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'word',
        'start_offset' => 3,
        'end_offset' => 8,
        ...$box,
    ])->assertInvalid(['start_offset']);

    expect($transcription->regions()->count())->toBe(1);
});
