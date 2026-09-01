<?php

use App\Models\CanonicalPassage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;

/**
 * Moving a cited passage, text and citation together.
 *
 * Cutting and pasting by hand cannot do this: a deletion covering a cited span
 * destroys it, so the assignment is lost exactly when it should travel.
 */

/**
 * "the quick brown fox", with "quick " cited.
 *
 * @return array{layer: TranscriptionLayer, segment: TranscriptionSegment}
 */
function citedPhrase(): array
{
    $layer = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($layer)
        ->for(CanonicalPassage::factory(), 'canonicalPassage')
        //                                 0123456789
        ->create(['start_offset' => 4, 'end_offset' => 10]);

    return ['layer' => $layer, 'segment' => $segment];
}

test('the words move and the citation goes with them', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['layer' => $layer, 'segment' => $segment] = citedPhrase();

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 19])
        ->assertRedirect();

    $layer->refresh();
    $moved = $segment->fresh();

    expect($layer->text)->toBe('the brown foxquick ')
        ->and($moved)->not->toBeNull()
        ->and(mb_substr($layer->text, $moved->start_offset, $moved->end_offset - $moved->start_offset))
        ->toBe('quick ');
});

test('doing the same by hand would have lost the citation', function () {
    // The reason this operation exists. Cut and paste as two ordinary edits:
    $this->actingAs(User::factory()->editor()->create());
    ['layer' => $layer, 'segment' => $segment] = citedPhrase();

    $this->patch(route('transcriptions.text.update', $layer), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => ''],
            ['start' => 13, 'end' => 13, 'text' => 'quick '],
        ],
        'text' => 'the brown foxquick ',
    ])->assertRedirect();

    expect(TranscriptionSegment::find($segment->id))->toBeNull();
});

test('moving backwards works too', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['layer' => $layer, 'segment' => $segment] = citedPhrase();

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 0]);

    $layer->refresh();
    $moved = $segment->fresh();

    expect($layer->text)->toBe('quick the brown fox')
        ->and($moved->start_offset)->toBe(0)
        ->and($moved->end_offset)->toBe(6);
});

test('an image alignment on the moved words travels with them', function () {
    // The alignment is to those words on the parchment, which the reordering
    // of a transcription does not change.
    $this->actingAs(User::factory()->editor()->create());
    ['layer' => $layer, 'segment' => $segment] = citedPhrase();

    $region = TranscriptionRegion::factory()->for($layer)
        ->create(['start_offset' => 4, 'end_offset' => 9, 'text' => 'quick']);

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 19]);

    $layer->refresh();
    $moved = $region->fresh();

    expect($moved)->not->toBeNull()
        ->and(mb_substr($layer->text, $moved->start_offset, $moved->end_offset - $moved->start_offset))
        ->toBe('quick');
});

test('a citation outside the moved passage shifts rather than travelling', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['layer' => $layer, 'segment' => $segment] = citedPhrase();

    $other = TranscriptionSegment::factory()->for($layer)
        ->for(CanonicalPassage::factory(), 'canonicalPassage')
        //                            "brown"
        ->create(['start_offset' => 10, 'end_offset' => 15]);

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 19]);

    $layer->refresh();
    $shifted = $other->fresh();

    expect(mb_substr($layer->text, $shifted->start_offset, $shifted->end_offset - $shifted->start_offset))
        ->toBe('brown');
});

test('a passage cannot be moved into the middle of itself', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['layer' => $layer, 'segment' => $segment] = citedPhrase();

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 7])
        ->assertInvalid(['target_offset']);

    expect($layer->fresh()->text)->toBe('the quick brown fox');
});

test('a destination past the end of the text is refused', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment] = citedPhrase();

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 99])
        ->assertInvalid(['target_offset']);
});

test('a guest cannot move a passage', function () {
    $this->actingAs(User::factory()->create());
    ['layer' => $layer, 'segment' => $segment] = citedPhrase();

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 19])
        ->assertForbidden();

    expect($layer->fresh()->text)->toBe('the quick brown fox');
});

test('a whole cited line takes its line break with it', function () {
    // Without this the moved words fuse with whatever they land against —
    // "προΐαψενμῆνιν" — which changes the text rather than only its order, and
    // makes one token of two for collation.
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => "alpha\nbeta\ngamma"]);
    $segment = TranscriptionSegment::factory()->for($layer)
        ->for(CanonicalPassage::factory(), 'canonicalPassage')
        //                              "beta"
        ->create(['start_offset' => 6, 'end_offset' => 10]);

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 0]);

    $layer->refresh();
    $moved = $segment->fresh();

    expect($layer->text)->toBe("beta\nalpha\ngamma")
        ->and(mb_substr($layer->text, $moved->start_offset, $moved->end_offset - $moved->start_offset))
        ->toBe('beta');
});

test('a passage that is not a whole line moves without one', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => 'alpha beta gamma']);
    $segment = TranscriptionSegment::factory()->for($layer)
        ->for(CanonicalPassage::factory(), 'canonicalPassage')
        //                              "beta "
        ->create(['start_offset' => 6, 'end_offset' => 11]);

    $this->patch(route('transcription-segments.move', $segment), ['target_offset' => 0]);

    expect($layer->fresh()->text)->toBe('beta alpha gamma');
});
