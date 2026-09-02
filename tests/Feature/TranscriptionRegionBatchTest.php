<?php

use App\Enums\WitnessType;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;

function makeTranscriptionWithImageAndText(string $text): array
{
    $witness = Witness::factory()->create(['type' => WitnessType::Manuscript]);
    $manuscript = Manuscript::factory()->for($witness)->create();
    $image = ManuscriptImage::factory()->for($manuscript)->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create(['text' => $text]);

    return [$transcription, $image];
}

test('batch splitting by character spaces regions by character position, leaving the gap its width', function () {
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

    // Five characters across the box: each letter one fifth wide, sitting at
    // its own character position — the space between the words keeps its
    // fifth rather than the letters packing tight over it.
    $cellWidth = 0.4 / 5;
    foreach ([0, 1, 3, 4] as $index => $charPosition) {
        $region = $regions[$index];
        expect((float) $region->x)->toEqualWithDelta(0.2 + $cellWidth * $charPosition, 0.0001)
            ->and((float) $region->width)->toEqualWithDelta($cellWidth, 0.0001)
            ->and((float) $region->y)->toEqualWithDelta(0.3, 0.0001)
            ->and((float) $region->height)->toEqualWithDelta(0.05, 0.0001);
    }
});

test('a multi-line selection spreads its lines down the guide box, word widths following letter counts', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$transcription, $image] = makeTranscriptionWithImageAndText("λόγος καλός\nἦν");

    $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'word',
        'start_offset' => 0,
        'end_offset' => mb_strlen("λόγος καλός\nἦν"),
        'x' => 0.1,
        'y' => 0.2,
        'width' => 0.6,
        'height' => 0.1,
    ])->assertRedirect();

    $regions = $transcription->regions()->orderBy('position')->get();

    expect($regions->pluck('text')->all())->toBe(['λόγος', 'καλός', 'ἦν']);

    // First line: eleven characters across the band, five for each word with
    // the space between them; both words on the top half of the box.
    expect((float) $regions[0]->x)->toEqualWithDelta(0.1, 0.0001)
        ->and((float) $regions[0]->width)->toEqualWithDelta(0.6 * 5 / 11, 0.0001)
        ->and((float) $regions[1]->x)->toEqualWithDelta(0.1 + 0.6 * 6 / 11, 0.0001)
        ->and((float) $regions[0]->y)->toEqualWithDelta(0.2, 0.0001)
        ->and((float) $regions[0]->height)->toEqualWithDelta(0.05, 0.0001);

    // Second line: its one word fills the lower band.
    expect((float) $regions[2]->x)->toEqualWithDelta(0.1, 0.0001)
        ->and((float) $regions[2]->width)->toEqualWithDelta(0.6, 0.0001)
        ->and((float) $regions[2]->y)->toEqualWithDelta(0.25, 0.0001)
        ->and((float) $regions[2]->height)->toEqualWithDelta(0.05, 0.0001);
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

test('batch splitting by line stacks one full-width region per line, markup allowed', function () {
    $this->actingAs(User::factory()->editor()->create());
    // A whole line fills its band, so a gap can't misplace anything — line
    // mapping stays available exactly where word-splitting is refused.
    [$transcription, $image] = makeTranscriptionWithImageAndText("λόγος [καλός]\nἦν δέ");

    $this->post(route('transcription-regions.store-batch', $transcription), [
        'manuscript_image_id' => $image->id,
        'granularity' => 'line',
        'start_offset' => 0,
        'end_offset' => mb_strlen("λόγος [καλός]\nἦν δέ"),
        'x' => 0.1,
        'y' => 0.2,
        'width' => 0.6,
        'height' => 0.1,
    ])->assertRedirect();

    $regions = $transcription->regions()->orderBy('position')->get();

    expect($regions->pluck('text')->all())->toBe(['λόγος [καλός]', 'ἦν δέ']);

    foreach ($regions as $index => $region) {
        expect((float) $region->x)->toEqualWithDelta(0.1, 0.0001)
            ->and((float) $region->width)->toEqualWithDelta(0.6, 0.0001)
            ->and((float) $region->y)->toEqualWithDelta(0.2 + 0.05 * $index, 0.0001)
            ->and((float) $region->height)->toEqualWithDelta(0.05, 0.0001);
    }
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
