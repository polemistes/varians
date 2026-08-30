<?php

use App\Enums\WitnessType;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\Transcription;
use App\Models\User;
use App\Models\Witness;

function makeTranscriptionWithImageAndText(string $text): array
{
    $witness = Witness::factory()->create(['type' => WitnessType::Manuscript]);
    $manuscript = Manuscript::factory()->for($witness)->create();
    $image = ManuscriptImage::factory()->for($manuscript)->create();
    $transcription = Transcription::factory()->for($witness)->create(['text' => $text]);

    return [$transcription, $image];
}

test('batch splitting by character creates one evenly-spaced region per non-space character', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImageAndText('ab cd');

    $response = $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'character',
        'start_offset' => 0,
        'end_offset' => 5,
        'x' => 0.2,
        'y' => 0.3,
        'width' => 0.4,
        'height' => 0.05,
    ]);

    $response->assertRedirect();

    $regions = $transcription->regions()->orderBy('position')->get();
    expect($regions)->toHaveCount(4)
        ->and($regions->pluck('text')->all())->toBe(['a', 'b', 'c', 'd'])
        ->and($regions->pluck('start_offset')->all())->toBe([0, 1, 3, 4])
        ->and($regions->pluck('end_offset')->all())->toBe([1, 2, 4, 5]);

    // Each cell is the guide box's width divided by 4, packed tightly in order.
    $cellWidth = 0.4 / 4;
    foreach ($regions as $index => $region) {
        expect((float) $region->x)->toEqualWithDelta(0.2 + $cellWidth * $index, 0.0001)
            ->and((float) $region->width)->toEqualWithDelta($cellWidth, 0.0001)
            ->and((float) $region->y)->toEqualWithDelta(0.3, 0.0001)
            ->and((float) $region->height)->toEqualWithDelta(0.05, 0.0001);
    }
});

test('batch splitting by word creates one region per word', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImageAndText('λόγος καλός ἐστιν');

    $response = $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'word',
        'start_offset' => 0,
        'end_offset' => mb_strlen('λόγος καλός ἐστιν'),
        'x' => 0,
        'y' => 0,
        'width' => 0.9,
        'height' => 0.1,
    ]);

    $response->assertRedirect();

    $regions = $transcription->regions()->orderBy('position')->get();
    expect($regions->pluck('text')->all())->toBe(['λόγος', 'καλός', 'ἐστιν']);
});

test('batch splitting appends after any existing regions rather than colliding on position', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImageAndText('ab');
    $transcription->regions()->create([
        'manuscript_image_id' => $image->id,
        'text' => 'existing',
        'start_offset' => 0,
        'end_offset' => 2,
        'position' => 5,
        'x' => 0, 'y' => 0, 'width' => 0.1, 'height' => 0.1,
    ]);

    $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'character',
        'start_offset' => 0,
        'end_offset' => 2,
        'x' => 0, 'y' => 0, 'width' => 0.2, 'height' => 0.05,
    ]);

    expect($transcription->regions()->orderBy('position')->pluck('position')->map(fn ($p) => (float) $p)->all())
        ->toBe([5.0, 6.0, 7.0]);
});

test('a selection containing markup cannot be batch split', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImageAndText('λόγος [καλός]');

    $response = $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'word',
        'start_offset' => 0,
        'end_offset' => mb_strlen('λόγος [καλός]'),
        'x' => 0, 'y' => 0, 'width' => 0.5, 'height' => 0.05,
    ]);

    $response->assertInvalid(['start_offset']);
    expect($transcription->regions)->toBeEmpty();
});

test('a whitespace-only selection has nothing to split', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImageAndText('ab   cd');

    $response = $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'word',
        'start_offset' => 2,
        'end_offset' => 5,
        'x' => 0, 'y' => 0, 'width' => 0.1, 'height' => 0.05,
    ]);

    $response->assertInvalid(['start_offset']);
});
