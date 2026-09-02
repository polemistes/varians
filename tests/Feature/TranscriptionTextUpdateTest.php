<?php

use App\Models\CanonicalPassage;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;

test('an insertion persists and shifts a trailing span', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 7, 'end_offset' => 11, // " sat"
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => 'big ']],
        'text' => 'the big cat sat',
    ]);

    $response->assertRedirect();
    expect($transcription->fresh()->text)->toBe('the big cat sat');
    $segment->refresh();
    expect($segment->start_offset)->toBe(11)
        ->and($segment->end_offset)->toBe(15)
        ->and($segment->needs_review)->toBeFalse();
});

test('deleting everything down to an empty transcription persists', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 7, // "cat"
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 11, 'text' => '']],
        'text' => '',
    ]);

    $response->assertRedirect();
    expect($transcription->fresh()->text)->toBe('');

    $segment->refresh();
    expect($segment->start_offset)->toBe(0)
        ->and($segment->end_offset)->toBe(0)
        ->and($segment->needs_review)->toBeTrue();
});

test('typing inside an existing segment extends it without flagging', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 7, // "cat"
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 5, 'end' => 5, 'text' => 'X']],
        'text' => 'the cXat sat',
    ]);

    $response->assertRedirect();
    $segment->refresh();
    expect($segment->start_offset)->toBe(4)
        ->and($segment->end_offset)->toBe(8)
        ->and($segment->needs_review)->toBeFalse();
});

test('deleting a segment\'s entire text tombstones it — zero-width and flagged, never destroyed', function () {
    // An autosave can fire mid-rearrangement, so a text state that merely
    // passes through must not destroy citation work; removing a span stays
    // an explicit editor action.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 7, // "cat"
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 7, 'text' => '']],
        'text' => 'the  sat',
    ]);

    $response->assertRedirect();
    $segment->refresh();
    expect($segment->start_offset)->toBe(4)
        ->and($segment->end_offset)->toBe(4)
        ->and($segment->needs_review)->toBeTrue();
});

test('replacing a segment\'s entire text keeps the row, resized and flagged', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 7, // "cat"
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 7, 'text' => 'dog']],
        'text' => 'the dog sat',
    ]);

    $response->assertRedirect();
    $segment->refresh();
    expect($segment->start_offset)->toBe(4)
        ->and($segment->end_offset)->toBe(7)
        ->and($segment->needs_review)->toBeTrue();
});

test('a region\'s denormalized text column stays synced with the edit', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $image = ManuscriptImage::factory()->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create([
        'start_offset' => 4, 'end_offset' => 7, 'text' => 'cat',
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 5, 'end' => 5, 'text' => 'X']],
        'text' => 'the cXat sat',
    ]);

    $response->assertRedirect();
    $region->refresh();
    expect($region->start_offset)->toBe(4)
        ->and($region->end_offset)->toBe(8)
        ->and($region->text)->toBe('cXat');
});

test('markup that would be malformed after the edit is rejected, nothing persists', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => '[']],
        'text' => 'the [cat sat',
    ]);

    $response->assertInvalid(['text']);
    expect($transcription->fresh()->text)->toBe('the cat sat');
});

test('a submitted text that doesn\'t match the server\'s own replay of ops is rejected', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 0, 'text' => '']],
        'text' => 'tampered',
    ]);

    // Keyed 'ops', distinct from a 'text' markup failure — the autosaving
    // client stops retrying on this one and offers a reload instead.
    $response->assertInvalid(['ops']);
    expect($transcription->fresh()->text)->toBe('the cat sat');
});

test('several disjoint ops in one save each transform their own span correctly', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $segmentA = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 3, // "the"
    ]);
    $segmentB = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 8, 'end_offset' => 11, // "sat"
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 0, 'end' => 0, 'text' => 'X'],
            ['start' => 12, 'end' => 12, 'text' => 'Y'],
        ],
        'text' => 'Xthe cat satY',
    ]);

    $response->assertRedirect();
    $segmentA->refresh();
    $segmentB->refresh();
    expect($segmentA->start_offset)->toBe(1)
        ->and($segmentA->end_offset)->toBe(4)
        ->and($segmentB->start_offset)->toBe(9)
        ->and($segmentB->end_offset)->toBe(13);
});

test('a guest cannot edit a transcription\'s text', function () {
    $this->actingAs(User::factory()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 0, 'text' => 'X']],
        'text' => 'Xthe cat sat',
    ]);

    $response->assertForbidden();
    expect($transcription->fresh()->text)->toBe('the cat sat');
});

test('destroying one part of a split citation flags the surviving parts for review', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "fox\nthe quick"]);
    $passage = CanonicalPassage::factory()->create();
    $destroyed = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]); // "fox"
    $survivor = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 4, 'end_offset' => 13, 'part' => 1]); // "the quick"

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 4, 'text' => '']], // deletes "fox\n"
        'text' => 'the quick',
    ]);

    $response->assertRedirect();
    $destroyed->refresh();
    expect($destroyed->start_offset)->toBe(0)
        ->and($destroyed->end_offset)->toBe(0)
        ->and($destroyed->needs_review)->toBeTrue()
        // The passage's witness text just lost a piece — its collation for
        // this layer is stale, so the surviving part must not pass silently.
        ->and($survivor->fresh()->needs_review)->toBeTrue();
});

test('destroying a segment with no sibling parts flags nothing else', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "fox\nthe quick"]);
    $destroyed = TranscriptionSegment::factory()->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]); // "fox", its own passage
    $unrelated = TranscriptionSegment::factory()->for($transcription)
        ->create(['start_offset' => 4, 'end_offset' => 13]); // different passage

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 4, 'text' => '']],
        'text' => 'the quick',
    ]);

    $response->assertRedirect();
    $destroyed->refresh();
    expect($destroyed->end_offset)->toBe($destroyed->start_offset)
        ->and($destroyed->needs_review)->toBeTrue()
        ->and($unrelated->fresh()->needs_review)->toBeFalse();
});
