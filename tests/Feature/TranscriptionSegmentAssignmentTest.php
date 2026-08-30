<?php

use App\Models\CanonicalPassage;
use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;

test('marking a span requires a citation — there is no unassigned state', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick brown fox']);

    $response = $this->post(route('transcription-segments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
    ]);

    $response->assertInvalid(['work_id', 'label']);
    expect($transcription->segments()->count())->toBe(0);
});

test('marking a span creates it already cited, in one step', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick brown fox']);
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $response = $this->post(route('transcription-segments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();

    $segment = $transcription->segments()->sole();
    expect($segment->canonicalPassage->work_id)->toBe($work->id)
        ->and($segment->canonicalPassage->label)->toBe('1.1')
        ->and($work->relatedWitnesses()->whereKey($transcription->witness_id)->exists())->toBeTrue();
});

test('a segment can be cited with an alphanumeric line label like "4a"', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick brown fox']);
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $response = $this->post(route('transcription-segments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.4a',
    ]);

    $response->assertRedirect();

    $segment = $transcription->segments()->sole();
    expect($segment->canonicalPassage->label)->toBe('1.4a')
        ->and($segment->canonicalPassage->address)->toBe(['book' => 1, 'line' => '4a']);
});

test('an alphanumeric line label sorts between its numeric neighbours', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $four = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 4], 'sort_key' => '00000001.00000004', 'label' => '1.4']);
    $five = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 5], 'sort_key' => '00000001.00000005', 'label' => '1.5']);
    $segment = TranscriptionSegment::factory()->create();

    $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => '1.4a',
    ]);

    $fourA = $segment->fresh()->canonicalPassage;
    expect(strcmp($four->sort_key, $fourA->sort_key))->toBeLessThan(0)
        ->and(strcmp($fourA->sort_key, $five->sort_key))->toBeLessThan(0);
});

test('a segment can be re-cited to a different work, creating the canonical passage', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $segment = TranscriptionSegment::factory()->create();

    $response = $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();

    $segment->refresh();
    expect($segment->canonicalPassage)->not->toBeNull()
        ->and($segment->canonicalPassage->work_id)->toBe($work->id)
        ->and($segment->canonicalPassage->label)->toBe('1.1')
        ->and($work->relatedWitnesses()->whereKey($segment->transcription->witness_id)->exists())->toBeTrue();
});

test('re-citing a segment reuses an existing canonical passage for the same citation', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $passage = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $segment = TranscriptionSegment::factory()->create();

    $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    expect($segment->fresh()->canonical_passage_id)->toBe($passage->id)
        ->and($work->canonicalPassages()->count())->toBe(1);
});

test('a segment\'s citation cannot be cleared — a work_id is always required', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();
    $segment = TranscriptionSegment::factory()->for($passage, 'canonicalPassage')->create();

    $response = $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => null,
    ]);

    $response->assertInvalid(['work_id']);
    expect($segment->fresh()->canonical_passage_id)->toBe($passage->id);
});

test('assigning a citation that does not match the work\'s numbering scheme fails', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $segment = TranscriptionSegment::factory()->create();
    $originalPassageId = $segment->canonical_passage_id;

    $response = $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => 'not-a-valid-citation!!',
    ]);

    $response->assertInvalid(['label']);
    expect($segment->fresh()->canonical_passage_id)->toBe($originalPassageId);
});
