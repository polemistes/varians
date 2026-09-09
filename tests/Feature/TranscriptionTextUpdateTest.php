<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Support\Edition\PassageAligner;

test('an insertion persists and shifts a trailing span', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 8, 'end_offset' => 11, // "sat"
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => 'big ']],
        'text' => 'the big cat sat',
    ]);

    $response->assertRedirect();
    expect($transcription->fresh()->text)->toBe('the big cat sat');
    $segment->refresh();
    expect($segment->start_offset)->toBe(12)
        ->and($segment->end_offset)->toBe(15)
        ->and($segment->needs_review)->toBeFalse();
});

test('deleting everything down to an empty transcription persists once confirmed', function () {
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
    expect($transcription->fresh()->text)->toBe('')
        // The citation went with its words — deleting text deletes
        // citations; undo restores both.
        ->and(TranscriptionSegment::find($segment->id))->toBeNull();
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

test('deleting a segment\'s entire text deletes it — a citation without text is nothing', function () {
    // User decision, reversing the earlier tombstone policy: deleting text
    // deletes citations. Undo protects the editor instead — the client's
    // history snapshots what an op destroyed and restores it via
    // transcription-segments.restore when the deletion is undone.
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
    expect(TranscriptionSegment::find($segment->id))->toBeNull();
});

test('blanking a cited transcript removes its citations — undo is what brings them back', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 7,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 11, 'text' => '']],
        'text' => '',
    ])->assertRedirect();

    expect($transcription->segments()->count())->toBe(0);
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

test('destroying one part of an uncollated split citation flags nothing — there is nothing stale', function () {
    // The old rule blind-flagged the survivors; narrowed (user decision):
    // a layer never collated on the passage has no stale collation, so the
    // surviving part passes silently (real incident: a rearranged,
    // never-collated line arrived flagged in both layers).
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
    expect(TranscriptionSegment::find($destroyed->id))->toBeNull()
        ->and($survivor->fresh()->needs_review)->toBeFalse();
});

test('destroying one part of a COLLATED split citation re-derives the collation', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->normalized()->create(['text' => "fox\nthe quick"]);
    $passage = CanonicalPassage::factory()->create();
    $partTwo = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]); // "fox"
    $survivor = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 4, 'end_offset' => 13, 'part' => 1]); // "the quick"
    PassageAligner::collate($passage, $transcription->segments()->get());
    expect(LemmaReading::where('transcription_layer_id', $transcription->id)->count())->toBe(3);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 4, 'text' => '']], // deletes "fox\n"
        'text' => 'the quick',
    ])->assertRedirect();

    // Collation re-derived against what remains: "the", "quick" — no flag,
    // no stale "fox" reading.
    $words = LemmaReading::where('transcription_layer_id', $transcription->id)->get()
        ->map(fn (LemmaReading $reading) => mb_substr(
            $transcription->fresh()->text,
            $reading->start_offset,
            $reading->end_offset - $reading->start_offset,
        ))->sort()->values()->all();

    expect($words)->toBe(['quick', 'the'])
        ->and($survivor->fresh()->needs_review)->toBeFalse();
});

test('destroying a part while a pinned reading holds the passage flags the surviving parts', function () {
    // Re-derivation is refused where an edition's selection pins the
    // collation — the late-part rule — so the survivors carry the flag.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->normalized()->create(['text' => "fox\nthe quick"]);
    $passage = CanonicalPassage::factory()->create();
    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]);
    $survivor = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 4, 'end_offset' => 13, 'part' => 1]);
    PassageAligner::collate($passage, $transcription->segments()->get());

    $pinned = LemmaReading::where('transcription_layer_id', $transcription->id)
        ->orderBy('start_offset')->skip(1)->first(); // "the"
    EditionLemma::create([
        'edition_id' => Edition::factory()->create()->id,
        'lemma_id' => $pinned->lemma_id,
        'selected_reading_id' => $pinned->id,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 4, 'text' => '']],
        'text' => 'the quick',
    ])->assertRedirect();

    expect($survivor->fresh()->needs_review)->toBeTrue();
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
    expect(TranscriptionSegment::find($destroyed->id))->toBeNull()
        ->and($unrelated->fresh()->needs_review)->toBeFalse();
});
