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
use App\Support\Transcription\AssignmentIntegrity;

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
        // The assignment went with its words — deleting text deletes
        // assignments; undo restores both.
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

test('deleting a segment\'s entire text deletes it — an assignment without text is nothing', function () {
    // User decision, reversing the earlier tombstone policy: deleting text
    // deletes assignments. Undo protects the editor instead — the client's
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

test('blanking an assigned transcript removes its assignments — undo is what brings them back', function () {
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
    // "Xthe" and "satY" are each one word, and each belongs wholly to the
    // assignment of the word it grew from.
    expect($segmentA->start_offset)->toBe(0)
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

test('destroying one part of an uncollated split assignment flags nothing — there is nothing stale', function () {
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

test('destroying one part of a COLLATED split assignment re-derives the collation', function () {
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

test('typing at the first character of an assigned line writes into that line, not the back of the one before', function () {
    // User report. Two assignments meeting at offset 6 — 'μῆνιν' then
    // 'ἄειδε' with no separator between them — and the caret placed at the
    // start of the second. The words typed there belong to the line being
    // written in.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'μῆνινἄειδε']);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 5,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 5, 'end_offset' => 10,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 5, 'end' => 5, 'text' => 'θ']],
        'text' => 'μῆνινθἄειδε',
    ])->assertRedirect();

    $first->refresh();
    $second->refresh();

    expect([$first->start_offset, $first->end_offset])->toBe([0, 5])
        ->and([$second->start_offset, $second->end_offset])->toBe([5, 11])
        ->and($first->needs_review)->toBeFalse()
        ->and($second->needs_review)->toBeFalse();
});

test('typing after an assignment with a separator before the next still continues that assignment', function () {
    // The ordinary case is untouched: nothing begins at the caret, so
    // end-gravity carries on absorbing what is typed right after a span.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν\nἄειδε"]);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 5,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 6, 'end_offset' => 11,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 5, 'end' => 5, 'text' => ' τε']],
        'text' => "μῆνιν τε\nἄειδε",
    ])->assertRedirect();

    expect([$first->fresh()->start_offset, $first->fresh()->end_offset])->toBe([0, 8])
        ->and([$second->fresh()->start_offset, $second->fresh()->end_offset])->toBe([9, 14]);
});

test('typing at the start of an assigned line joins that line, and leaves no assignment inside a word', function () {
    // The reported case, in the layout 154 of the pairs in real data have:
    // two assigned lines with a newline between them, caret at the first
    // letter of the second. The letter used to fall outside both, leaving
    // the second assignment beginning inside a word and flagged for review.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 11,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => 'Χ']],
        'text' => "μῆνιν ἄειδε\nΧθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    $first->refresh();
    $second->refresh();

    // The letter is inside the line it was typed into...
    expect([$second->start_offset, $second->end_offset])->toBe([12, 26])
        ->and([$first->start_offset, $first->end_offset])->toBe([0, 11])
        // ...so neither assignment begins or ends inside a word.
        ->and($second->boundary_review)->toBeFalse()
        ->and($first->boundary_review)->toBeFalse()
        ->and(AssignmentIntegrity::issues($transcription->fresh()))->toBe([]);
});

test('a separator typed at the start of an assigned line stays outside it', function () {
    // An assignment never BEGINS with whitespace: the space belongs above it,
    // and the assignment moves along onto its own first word.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => ' ']],
        'text' => "μῆνιν ἄειδε\n θεὰ Πηληϊάδεω",
    ])->assertRedirect();

    expect([$second->fresh()->start_offset, $second->fresh()->end_offset])->toBe([13, 26]);
});

test('typing in front of an assigned line writes into that line', function () {
    // The rule an editor can see: the caret touches the assignment's first
    // word, so what is typed there belongs to that assignment.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 11,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => 'Χ']],
        'text' => "μῆνιν ἄειδε\nΧθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    expect([$second->fresh()->start_offset, $second->fresh()->end_offset])->toBe([12, 26])
        ->and([$first->fresh()->start_offset, $first->fresh()->end_offset])->toBe([0, 11])
        ->and($second->fresh()->boundary_review)->toBeFalse();
});

test('a whole word typed in front of an assigned line belongs to it too, keystroke by keystroke', function () {
    // What follows from the same rule, and what the editor asked for: the
    // assignment grows with the words written into it, rather than giving
    // them back the moment a space appears.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'μῆνιν ἄειδε θεὰ Πηληϊάδεω']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    $text = 'μῆνιν ἄειδε θεὰ Πηληϊάδεω';

    foreach (['ν', 'ῦ', 'ν', ' '] as $index => $character) {
        $at = 12 + $index;
        $text = mb_substr($text, 0, $at).$character.mb_substr($text, $at);

        $this->patch(route('transcriptions.text.update', $transcription), [
            'ops' => [['start' => $at, 'end' => $at, 'text' => $character]],
            'text' => $text,
        ])->assertRedirect();
    }

    $segment->refresh();

    expect($text)->toBe('μῆνιν ἄειδε νῦν θεὰ Πηληϊάδεω')
        ->and(mb_substr($text, $segment->start_offset, $segment->end_offset - $segment->start_offset))
        ->toBe('νῦν θεὰ Πηληϊάδεω');
});

test('whitespace typed against an assignment stays in it — nothing is trimmed back out', function () {
    // User decision, reversing an earlier one: a space typed with the caret
    // against the assignment's words is the assignment's. Pulling it back out
    // read as the line having ended, and left the next word outside too.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 9, // "quick"
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 9, 'end' => 9, 'text' => ' ']],
        'text' => 'the quick  brown fox',
    ])->assertRedirect();

    $segment->refresh();

    expect([$segment->start_offset, $segment->end_offset])->toBe([4, 10])
        ->and(mb_substr('the quick  brown fox', 4, 6))->toBe('quick ');
});

test('typing between two assignments is taken up by the one before it', function () {
    // User decision: typing can no longer leave words unassigned in the midst
    // of assigned text. Standing on a blank line between two assigned lines, the
    // line before carries on over the break and takes what is written.
    // Unassigned text is something an editor asks for outright.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\n\nθεὰ Πηληϊάδεω"]);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 11,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 13, 'end_offset' => 26,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => 'σῆμα']],
        'text' => "μῆνιν ἄειδε\nσῆμα\nθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    $text = "μῆνιν ἄειδε\nσῆμα\nθεὰ Πηληϊάδεω";

    expect(mb_substr($text, $first->fresh()->start_offset, $first->fresh()->end_offset - $first->fresh()->start_offset))
        ->toBe("μῆνιν ἄειδε\nσῆμα")
        ->and(mb_substr($text, $second->fresh()->start_offset, 3))->toBe('θεὰ');
});

test('deleting the line break before an assignment runs it onto the line before, both assignments intact', function () {
    // What Backspace just after a marker now does. The assignments keep their
    // own words and meet flush, which AssignmentIntegrity allows: two lines
    // run together is a real thing for a transcript to record.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 11,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 11, 'end' => 12, 'text' => '']],
        'text' => 'μῆνιν ἄειδεθεὰ Πηληϊάδεω',
    ])->assertRedirect();

    $first->refresh();
    $second->refresh();

    expect($transcription->fresh()->text)->toBe('μῆνιν ἄειδεθεὰ Πηληϊάδεω')
        ->and([$first->start_offset, $first->end_offset])->toBe([0, 11])
        ->and([$second->start_offset, $second->end_offset])->toBe([11, 24])
        ->and($first->boundary_review)->toBeFalse()
        ->and($second->boundary_review)->toBeFalse()
        ->and($first->needs_review)->toBeFalse()
        ->and($second->needs_review)->toBeFalse();
});

test('a space then a word at the end of an assignment continues that assignment', function () {
    // User report: the space rightly falls outside the assignment, but the
    // word written after it was starting an unassigned stretch. An assignment
    // keeps one space of buffer, and writing past it carries on the line.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'μῆνιν ἄειδε']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 11,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 11, 'end' => 11, 'text' => ' ']],
        'text' => 'μῆνιν ἄειδε ',
    ])->assertRedirect();

    // The space was typed against the assignment's last word, so it is the
    // assignment's — it is not pulled back out.
    expect([$segment->fresh()->start_offset, $segment->fresh()->end_offset])->toBe([0, 12]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => 'θεὰ']],
        'text' => 'μῆνιν ἄειδε θεὰ',
    ])->assertRedirect();

    $segment->refresh();

    expect(mb_substr('μῆνιν ἄειδε θεὰ', $segment->start_offset, $segment->end_offset - $segment->start_offset))
        ->toBe('μῆνιν ἄειδε θεὰ');
});

test('a word written with whitespace between it and an assignment belongs to nobody', function () {
    // Touching means touching. A caret with a space between it and every
    // assignment is standing in the gap, and the gap is nobody's — which is
    // what keeps an assignment from reaching out and taking it.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => ' θεὰ Πηληϊάδεω']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 1, 'end_offset' => 14,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 0, 'text' => 'ὦ']],
        'text' => 'ὦ θεὰ Πηληϊάδεω',
    ])->assertRedirect();

    $segment->refresh();

    expect(mb_substr('ὦ θεὰ Πηληϊάδεω', $segment->start_offset, $segment->end_offset - $segment->start_offset))
        ->toBe('θεὰ Πηληϊάδεω');
});

test('text that ARRIVES between two assignments stays unassigned', function () {
    // The exception to the rule above (user decision): a paste, a drop or an
    // import comes in unassigned and stays so. Only typing is held to assigning
    // what it lands among.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\n\nθεὰ Πηληϊάδεω"]);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 11,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 13, 'end_offset' => 26,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => 'σῆμα', 'imported' => true]],
        'text' => "μῆνιν ἄειδε\nσῆμα\nθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    $text = "μῆνιν ἄειδε\nσῆμα\nθεὰ Πηληϊάδεω";
    $first->refresh();
    $second->refresh();

    expect(mb_substr($text, $first->start_offset, $first->end_offset - $first->start_offset))
        ->toBe('μῆνιν ἄειδε')
        ->and(mb_substr($text, $second->start_offset, $second->end_offset - $second->start_offset))
        ->toBe('θεὰ Πηληϊάδεω');
});

test('the near side of a marker belongs to the assignment that ENDS there', function () {
    // Two assignments meeting flush: the near side is the first one's, so what
    // is typed there is written into IT rather than into the line the marker
    // announces. This is the case the caret's side exists for.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'μῆνινἄειδε']);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 5,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 5, 'end_offset' => 10,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 5, 'end' => 5, 'text' => 'Χ', 'side' => 'before']],
        'text' => 'μῆνινΧἄειδε',
    ])->assertRedirect();

    expect([$first->fresh()->start_offset, $first->fresh()->end_offset])->toBe([0, 6])
        ->and([$second->fresh()->start_offset, $second->fresh()->end_offset])->toBe([6, 11]);
});

test('the near side of a marker belongs to what lies BEFORE it, across whitespace and all', function () {
    // User report: arrowing the caret back past a marker and typing put the
    // words at the start of the following line instead of the end of the one
    // the caret stood in. The near side belongs to what lies before it — the
    // assignment ending against it, or the one carrying on from further back.
    // Nothing is left stranded either way.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'μῆνιν ἄειδε']);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 5,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 6, 'end_offset' => 11,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 6, 'end' => 6, 'text' => 'Χ', 'side' => 'before']],
        'text' => 'μῆνιν Χἄειδε',
    ])->assertRedirect();

    // The line the caret stood in carries on over the space and takes it.
    expect(mb_substr('μῆνιν Χἄειδε', $first->fresh()->start_offset, $first->fresh()->end_offset - $first->fresh()->start_offset))
        ->toBe('μῆνιν Χ')
        ->and(mb_substr('μῆνιν Χἄειδε', $second->fresh()->start_offset, 5))->toBe('ἄειδε');
});

test('typing on the far side of a marker writes into the assignment it announces', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    // The same offset and the same keystroke — only the side differs.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => 'Χ', 'side' => 'after']],
        'text' => "μῆνιν ἄειδε\nΧθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    expect([$second->fresh()->start_offset, $second->fresh()->end_offset])->toBe([12, 26]);
});

test('the caret side says nothing about a paste or a deletion', function () {
    // Only a plain insertion can be spoken for; anything else keeps to the
    // ordinary rules.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 9,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 9, 'text' => 'slow', 'side' => 'before']],
        'text' => 'the slow brown fox',
    ])->assertRedirect();

    expect([$segment->fresh()->start_offset, $segment->fresh()->end_offset])->toBe([4, 8]);
});

test('a line break at the start of an assigned line takes the line and its marker down together', function () {
    // User report: the marker stayed on the line above. An assignment never
    // BEGINS with whitespace, so the break belongs above it and the assignment
    // moves down onto its words, marker and all.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $first = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 11,
    ]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => "\n", 'side' => 'after']],
        'text' => "μῆνιν ἄειδε\n\nθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    $text = "μῆνιν ἄειδε\n\nθεὰ Πηληϊάδεω";
    $first->refresh();
    $second->refresh();

    // The assignment begins on its first WORD, so the marker renders there.
    expect([$second->start_offset, $second->end_offset])->toBe([13, 26])
        ->and(mb_substr($text, $second->start_offset, 3))->toBe('θεὰ')
        ->and([$first->start_offset, $first->end_offset])->toBe([0, 11]);
});

test('a letter at the start of an assigned line still writes into it', function () {
    // The same caret, the same side — only whitespace is held out.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "μῆνιν ἄειδε\nθεὰ Πηληϊάδεω"]);
    $second = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 12, 'end_offset' => 25,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => 'Χ', 'side' => 'after']],
        'text' => "μῆνιν ἄειδε\nΧθεὰ Πηληϊάδεω",
    ])->assertRedirect();

    expect([$second->fresh()->start_offset, $second->fresh()->end_offset])->toBe([12, 26]);
});
