<?php

use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;

test('a span can be resized', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('transcription-segments.update', $segment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    $response->assertRedirect();

    $segment->refresh();
    expect($segment->start_offset)->toBe(4)
        ->and($segment->end_offset)->toBe(9);
});

test('resizing a span clears its needs_review flag', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3, 'needs_review' => true]);

    $this->patch(route('transcription-segments.update', $segment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    expect($segment->fresh()->needs_review)->toBeFalse();
});

test('a span cannot be resized past the end of the transcription text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'short']);
    $segment = TranscriptionSegment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('transcription-segments.update', $segment), [
        'start_offset' => 0,
        'end_offset' => 999,
    ]);

    $response->assertInvalid(['end_offset']);
});

test('a new span starts out not needing review', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick brown fox']);
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $this->post(route('transcription-segments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    expect($transcription->segments()->sole()->needs_review)->toBeFalse();
});

test('an editor can resize a span on another editor\'s transcription', function () {
    $this->actingAs(User::factory()->editor()->create());
    $author = User::factory()->editor()->create();
    $transcription = Transcription::factory()->for($author)->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('transcription-segments.update', $segment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    $response->assertRedirect();
    expect($segment->fresh()->start_offset)->toBe(4);
});

test('a guest cannot modify a span', function () {
    $this->actingAs(User::factory()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('transcription-segments.update', $segment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    $response->assertForbidden();
    expect($segment->fresh()->start_offset)->toBe(0);
});
