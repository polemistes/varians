<?php

use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\Assignment;
use App\Models\User;
use App\Models\Work;

test('a span can be resized', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $assignment = Assignment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('assignments.update', $assignment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    $response->assertRedirect();

    $assignment->refresh();
    expect($assignment->start_offset)->toBe(4)
        ->and($assignment->end_offset)->toBe(9);
});

test('resizing a span clears its needs_review flag', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $assignment = Assignment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3, 'needs_review' => true]);

    $this->patch(route('assignments.update', $assignment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    expect($assignment->fresh()->needs_review)->toBeFalse();
});

test('a span cannot be resized past the end of the transcription text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'short']);
    $assignment = Assignment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('assignments.update', $assignment), [
        'start_offset' => 0,
        'end_offset' => 999,
    ]);

    $response->assertInvalid(['end_offset']);
});

test('a new span starts out not needing review', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $this->post(route('assignments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    expect($transcription->assignments()->sole()->needs_review)->toBeFalse();
});

test('an editor can resize a span on another editor\'s transcription', function () {
    $this->actingAs(User::factory()->editor()->create());
    $author = User::factory()->editor()->create();
    $transcription = TranscriptionLayer::factory()->for($author)->create(['text' => 'the quick brown fox']);
    $assignment = Assignment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('assignments.update', $assignment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    $response->assertRedirect();
    expect($assignment->fresh()->start_offset)->toBe(4);
});

test('a guest cannot modify a span', function () {
    $this->actingAs(User::factory()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $assignment = Assignment::factory()
        ->for($transcription)
        ->create(['start_offset' => 0, 'end_offset' => 3]);

    $response = $this->patch(route('assignments.update', $assignment), [
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    $response->assertForbidden();
    expect($assignment->fresh()->start_offset)->toBe(0);
});

test('an assignment moved to begin at the end of the line before it stays there through later edits', function () {
    // User report: the marker could not be pulled back to the previous
    // line. Moving bounds is now an ordinary action on any assignment, not
    // one reserved for a span flagged for review.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $assignment = Assignment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    // Take in "ἄειδε", the last word of the line before.
    $this->patch(route('assignments.update', $assignment), [
        'start_offset' => 6,
        'end_offset' => 25,
    ])->assertRedirect();

    expect(mb_substr("μῆνιν ἄειδε\nθεὰ Πηληϊάδεω", $assignment->fresh()->start_offset, 5))->toBe('ἄειδε');

    // An edit elsewhere in the layer must not pull it back.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 0, 'text' => 'ὦ ']],
        'text' => "ὦ μῆνιν ἄειδε\nθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    $assignment->refresh();

    expect(mb_substr("ὦ μῆνιν ἄειδε\nθεὰ Πηληϊάδεω", $assignment->start_offset, $assignment->end_offset - $assignment->start_offset))
        ->toBe("ἄειδε\nθεὰ Πηληϊάδεω");
});
