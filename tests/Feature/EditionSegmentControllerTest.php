<?php

use App\Models\Assignment;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionSegment;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;

function editionForSegments(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();

    return compact('work', 'edition');
}

function assignedSegment(Work $work, int $line): Segment
{
    $formatted = $work->referenceScheme->format(['book' => 1, 'line' => $line]);

    return Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => $line],
        'sort_key' => $formatted['sort_key'],
        'label' => $formatted['label'],
    ]);
}

test('a selected span adds every already-assigned assignment inside it, in physical order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $line2 = assignedSegment($work, 2);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first second']);
    Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($transcription)->for($line2, 'segment')->create(['start_offset' => 6, 'end_offset' => 12]);

    $response = $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 12,
    ]);

    $response->assertRedirect();

    $added = EditionSegment::where('edition_id', $edition->id)->orderBy('position')->get();
    expect($added->pluck('segment_id')->all())->toBe([$line1->id, $line2->id])
        ->and($added->pluck('transcription_layer_id')->unique()->all())->toBe([$transcription->id]);

    // Materialized (real Lemma columns), not just recorded.
    expect(Lemma::where('segment_id', $line1->id)->count())->toBe(1)
        ->and(Lemma::where('segment_id', $line2->id)->count())->toBe(1);
});

test('a span covering only already-added or unassigned text is a silent no-op, not a validation error', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first unassigned']);
    $assignment = Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    expect(EditionSegment::where('edition_id', $edition->id)->count())->toBe(1);

    // Re-selecting the same (already-added) span again.
    $response = $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    $response->assertRedirect();
    expect(EditionSegment::where('edition_id', $edition->id)->count())->toBe(1);

    // Selecting the unassigned remainder of the text.
    $response = $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 6,
        'end_offset' => 13,
    ]);
    $response->assertRedirect();
    expect(EditionSegment::where('edition_id', $edition->id)->count())->toBe(1);

    expect($assignment)->not->toBeNull();
});

test('bulk add orders by the manuscript\'s own physical offset, not numbering order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $line2 = assignedSegment($work, 2);
    $line3 = assignedSegment($work, 3);

    // A scribal displacement: physically, in this manuscript, line 3 comes
    // first, then line 1, then line 2 — "third first second".
    $transcription = TranscriptionLayer::factory()->create(['text' => 'third first second']);
    Assignment::factory()->for($transcription)->for($line3, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 6, 'end_offset' => 11]);
    Assignment::factory()->for($transcription)->for($line2, 'segment')->create(['start_offset' => 12, 'end_offset' => 19]);

    $response = $this->post(route('edition-segments.store-bulk', $edition), [
        'transcription_layer_id' => $transcription->id,
        'from_segment_id' => $line1->id,
        'to_segment_id' => $line3->id,
    ]);

    $response->assertRedirect();

    // The manuscript's own reading order — 3, 1, 2 — not numbering order 1, 2, 3.
    $added = EditionSegment::where('edition_id', $edition->id)->orderBy('position')->get();
    expect($added->pluck('segment_id')->all())->toBe([$line3->id, $line1->id, $line2->id]);
});

test('bulk add skips a segment already claimed by another transcription, but still aligns this transcription\'s own reading as a candidate', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);

    $a = TranscriptionLayer::factory()->create(['text' => 'first']);
    $assignmentA = Assignment::factory()->for($a)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    SegmentAdder::add($edition, $assignmentA, 1.0);

    $b = TranscriptionLayer::factory()->create(['text' => 'uno']);
    Assignment::factory()->for($b)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 3]);

    $this->post(route('edition-segments.store-bulk', $edition), [
        'transcription_layer_id' => $b->id,
        'from_segment_id' => $line1->id,
        'to_segment_id' => $line1->id,
    ]);

    // Still only one EditionSegment for line1, still sourced from A.
    $editionSegment = EditionSegment::where('edition_id', $edition->id)->sole();
    expect($editionSegment->transcription_layer_id)->toBe($a->id);

    // But B's own reading was aligned into the shared collation, so it's
    // available as a candidate — not silently dropped.
    $lemma = Lemma::where('segment_id', $line1->id)->sole();
    expect($lemma->readings->pluck('transcription_layer_id')->all())->toContain($b->id);
});

test('removing a segment frees it up for re-adding elsewhere and clears this edition\'s own selections for it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first']);
    $assignment = Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    $editionSegment = EditionSegment::where('edition_id', $edition->id)->sole();

    $lemma = Lemma::where('segment_id', $line1->id)->sole();
    $reading = LemmaReading::where('lemma_id', $lemma->id)->sole();
    EditionLemma::create(['edition_id' => $edition->id, 'lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);

    $response = $this->delete(route('edition-segments.destroy', $edition), ['segment_ids' => [$line1->id]]);
    $response->assertRedirect();

    expect(EditionSegment::find($editionSegment->id))->toBeNull()
        ->and(EditionLemma::where('edition_id', $edition->id)->exists())->toBeFalse()
        // Lemma/LemmaReading are edition-independent shared collation — untouched.
        ->and(Lemma::find($lemma->id))->not->toBeNull();

    // Freed up — addable again.
    $response = $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    $response->assertRedirect();
    expect(EditionSegment::where('edition_id', $edition->id)->count())->toBe(1);
});

test('a bulk add rejects a range that ends before it starts', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $line2 = assignedSegment($work, 2);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first second']);
    Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($transcription)->for($line2, 'segment')->create(['start_offset' => 6, 'end_offset' => 12]);

    $response = $this->post(route('edition-segments.store-bulk', $edition), [
        'transcription_layer_id' => $transcription->id,
        'from_segment_id' => $line2->id,
        'to_segment_id' => $line1->id,
    ]);

    $response->assertInvalid(['to_segment_id']);
    expect(EditionSegment::count())->toBe(0);
});

test('a bulk add rejects a transcription with no assignments in this work', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $unrelated = TranscriptionLayer::factory()->create();

    $response = $this->post(route('edition-segments.store-bulk', $edition), [
        'transcription_layer_id' => $unrelated->id,
        'from_segment_id' => $line1->id,
        'to_segment_id' => $line1->id,
    ]);

    $response->assertInvalid(['transcription_layer_id']);
});

test('a guest cannot add or remove edition segments', function () {
    $this->actingAs(User::factory()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first']);
    Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ])->assertForbidden();

    $this->post(route('edition-segments.store-bulk', $edition), [
        'transcription_layer_id' => $transcription->id,
        'from_segment_id' => $line1->id,
        'to_segment_id' => $line1->id,
    ])->assertForbidden();

    expect(EditionSegment::count())->toBe(0);

    $this->delete(route('edition-segments.destroy', $edition), ['segment_ids' => [$line1->id]])->assertForbidden();
});

test('an assignment added late lands where its manuscript has it, not at the end', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $line2 = assignedSegment($work, 2);
    $line3 = assignedSegment($work, 3);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first second third']);
    Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($transcription)->for($line2, 'segment')->create(['start_offset' => 6, 'end_offset' => 12]);
    Assignment::factory()->for($transcription)->for($line3, 'segment')->create(['start_offset' => 13, 'end_offset' => 18]);

    // Lines 1 and 3 first, by segment id — then line 2, which the
    // manuscript has between them.
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'segment_ids' => [$line1->id, $line3->id],
    ])->assertRedirect();
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'segment_ids' => [$line2->id],
    ])->assertRedirect();

    $stored = EditionSegment::where('edition_id', $edition->id)->orderBy('position')->pluck('segment_id')->all();
    expect($stored)->toBe([$line1->id, $line2->id, $line3->id]);
});

test('an assignment from a witness sharing no segment with the edition goes by numbering order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $line2 = assignedSegment($work, 2);
    $line3 = assignedSegment($work, 3);
    $a = TranscriptionLayer::factory()->create(['text' => 'third first']);
    Assignment::factory()->for($a)->for($line3, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($a)->for($line1, 'segment')->create(['start_offset' => 6, 'end_offset' => 11]);
    $b = TranscriptionLayer::factory()->create(['text' => 'second']);
    Assignment::factory()->for($b)->for($line2, 'segment')->create(['start_offset' => 0, 'end_offset' => 6]);

    // A prints 3 before 1, as the manuscript has it; B's line 2 knows
    // nothing of A's order, so it follows the segment numbering: after 1.
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $a->id,
        'segment_ids' => [$line1->id, $line3->id],
    ])->assertRedirect();
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $b->id,
        'segment_ids' => [$line2->id],
    ])->assertRedirect();

    $stored = EditionSegment::where('edition_id', $edition->id)->orderBy('position')->pluck('segment_id')->all();
    expect($stored)->toBe([$line3->id, $line1->id, $line2->id]);
});

test('several segments are removed at once', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $line2 = assignedSegment($work, 2);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first second']);
    Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($transcription)->for($line2, 'segment')->create(['start_offset' => 6, 'end_offset' => 12]);
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'segment_ids' => [$line1->id, $line2->id],
    ]);

    $this->delete(route('edition-segments.destroy', $edition), ['segment_ids' => [$line1->id, $line2->id]])->assertRedirect();

    expect(EditionSegment::where('edition_id', $edition->id)->count())->toBe(0);
});

test('a segment of another work never enters an edition, whichever way it is offered', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForSegments();
    $line1 = assignedSegment($work, 1);
    $foreign = Segment::factory()->for(Work::factory())->create();
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first second']);
    Assignment::factory()->for($transcription)->for($line1, 'segment')->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($transcription)->for($foreign, 'segment')->create(['start_offset' => 6, 'end_offset' => 12]);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 12,
    ])->assertRedirect();
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'segment_ids' => [$foreign->id],
    ])->assertRedirect();

    expect(EditionSegment::where('edition_id', $edition->id)->pluck('segment_id')->all())->toBe([$line1->id]);
});
