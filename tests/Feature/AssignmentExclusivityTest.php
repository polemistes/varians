<?php

use App\Models\Assignment;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Work;

/**
 * Text is assigned ONCE (user decision): no stretch of a layer's text belongs
 * to two segments, of the same work or of different ones, and a span must
 * hold words. Overlap is refused where a span is made or moved, and skipped
 * wherever the machinery would otherwise manufacture one.
 */
test('marking a span over words another segment already holds is refused', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $held = Assignment::factory()->for($layer)->create(['start_offset' => 4, 'end_offset' => 15]); // "quick brown"
    $other = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    $response = $this->post(route('assignments.store', $layer), [
        'start_offset' => 10,
        'end_offset' => 19, // "brown fox" — "brown" is the other segment's
        'work_id' => $other->id,
        'label' => '1.1',
    ]);

    $response->assertSessionHasErrors('start_offset');
    expect($layer->assignments()->count())->toBe(1)
        ->and(session('errors')->first('start_offset'))->toContain($held->segment->label);
});

test('a selection of nothing but whitespace is no assignment', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "the fox\n\n  \nsat"]);
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    $this->post(route('assignments.store', $layer), [
        'start_offset' => 8,
        'end_offset' => 11,
        'work_id' => $work->id,
        'label' => '1.1',
    ])->assertSessionHasErrors('start_offset');

    expect($layer->assignments()->count())->toBe(0);
});

test('a span cannot be resized onto words another span holds', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $first = Assignment::factory()->for($layer)->create(['start_offset' => 0, 'end_offset' => 9]); // "the quick"
    Assignment::factory()->for($layer)->create(['start_offset' => 10, 'end_offset' => 19]); // "brown fox"

    $this->patch(route('assignments.update', $first), [
        'start_offset' => 0,
        'end_offset' => 15,
    ])->assertSessionHasErrors('start_offset');

    expect($first->fresh()->end_offset)->toBe(9);
});

test('an undo does not restore an assignment over words another segment has since taken', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $taken = Assignment::factory()->for($layer)->create(['start_offset' => 4, 'end_offset' => 15]);
    $segment = Segment::factory()->for(Work::factory())->create();

    $this->post(route('transcription-spans.restore', $layer), [
        'assignments' => [[
            'segment_id' => $segment->id,
            'start_offset' => 10,
            'end_offset' => 19,
            'part' => 1,
        ]],
    ])->assertRedirect();

    expect($layer->assignments()->count())->toBe(1)
        ->and($layer->assignments()->sole()->is($taken))->toBeTrue();
});

test('the sibling layer receives no counterpart over words it already assigns elsewhere', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)
        ->create(['text' => 'γιγνεται παντα ρει']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)
        ->create(['text' => 'γίνεται πάντα ῥεῖ']);
    // The normalized layer already assigns "πάντα ῥεῖ" to some segment.
    Assignment::factory()->for($normalized)->create(['start_offset' => 8, 'end_offset' => 17]);
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    $this->post(route('assignments.store', $diplomatic), [
        'work_id' => $work->id,
        'label' => '1.2',
        'start_offset' => 0,
        'end_offset' => 14, // "γιγνεται παντα" — would overlap the sibling's span on "παντα"
    ])->assertRedirect()->assertSessionHasNoErrors();

    expect($diplomatic->assignments()->count())->toBe(1)
        ->and($normalized->assignments()->count())->toBe(1);
});
