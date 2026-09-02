<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAdder;

function editionForPassages(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();

    return compact('work', 'edition');
}

function citedPassage(Work $work, int $line): CanonicalPassage
{
    $formatted = $work->referenceScheme->format(['book' => 1, 'line' => $line]);

    return CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => $line],
        'sort_key' => $formatted['sort_key'],
        'label' => $formatted['label'],
    ]);
}

test('a selected span adds every already-cited segment inside it, in physical order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $line2 = citedPassage($work, 2);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first second']);
    TranscriptionSegment::factory()->for($transcription)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($transcription)->for($line2, 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 12]);

    $response = $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 12,
    ]);

    $response->assertRedirect();

    $added = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->get();
    expect($added->pluck('canonical_passage_id')->all())->toBe([$line1->id, $line2->id])
        ->and($added->pluck('transcription_layer_id')->unique()->all())->toBe([$transcription->id]);

    // Materialized (real Lemma columns), not just recorded.
    expect(Lemma::where('canonical_passage_id', $line1->id)->count())->toBe(1)
        ->and(Lemma::where('canonical_passage_id', $line2->id)->count())->toBe(1);
});

test('a span covering only already-added or uncited text is a silent no-op, not a validation error', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first uncited']);
    $segment = TranscriptionSegment::factory()->for($transcription)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    expect(EditionPassage::where('edition_id', $edition->id)->count())->toBe(1);

    // Re-selecting the same (already-added) span again.
    $response = $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    $response->assertRedirect();
    expect(EditionPassage::where('edition_id', $edition->id)->count())->toBe(1);

    // Selecting the uncited remainder of the text.
    $response = $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 6,
        'end_offset' => 13,
    ]);
    $response->assertRedirect();
    expect(EditionPassage::where('edition_id', $edition->id)->count())->toBe(1);

    expect($segment)->not->toBeNull();
});

test('bulk add orders by the manuscript\'s own physical offset, not citation order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $line2 = citedPassage($work, 2);
    $line3 = citedPassage($work, 3);

    // A scribal displacement: physically, in this manuscript, line 3 comes
    // first, then line 1, then line 2 — "third first second".
    $transcription = TranscriptionLayer::factory()->create(['text' => 'third first second']);
    TranscriptionSegment::factory()->for($transcription)->for($line3, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($transcription)->for($line1, 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 11]);
    TranscriptionSegment::factory()->for($transcription)->for($line2, 'canonicalPassage')->create(['start_offset' => 12, 'end_offset' => 19]);

    $response = $this->post(route('edition-passages.store-bulk', $edition), [
        'transcription_layer_id' => $transcription->id,
        'from_canonical_passage_id' => $line1->id,
        'to_canonical_passage_id' => $line3->id,
    ]);

    $response->assertRedirect();

    // The manuscript's own reading order — 3, 1, 2 — not citation order 1, 2, 3.
    $added = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->get();
    expect($added->pluck('canonical_passage_id')->all())->toBe([$line3->id, $line1->id, $line2->id]);
});

test('bulk add skips a passage already claimed by another transcription, but still aligns this transcription\'s own reading as a candidate', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);

    $a = TranscriptionLayer::factory()->create(['text' => 'first']);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    PassageAdder::add($edition, $segmentA, 1.0);

    $b = TranscriptionLayer::factory()->create(['text' => 'uno']);
    TranscriptionSegment::factory()->for($b)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 3]);

    $this->post(route('edition-passages.store-bulk', $edition), [
        'transcription_layer_id' => $b->id,
        'from_canonical_passage_id' => $line1->id,
        'to_canonical_passage_id' => $line1->id,
    ]);

    // Still only one EditionPassage for line1, still sourced from A.
    $editionPassage = EditionPassage::where('edition_id', $edition->id)->sole();
    expect($editionPassage->transcription_layer_id)->toBe($a->id);

    // But B's own reading was aligned into the shared collation, so it's
    // available as a candidate — not silently dropped.
    $lemma = Lemma::where('canonical_passage_id', $line1->id)->sole();
    expect($lemma->readings->pluck('transcription_layer_id')->all())->toContain($b->id);
});

test('removing a passage frees it up for re-adding elsewhere and clears this edition\'s own selections for it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first']);
    $segment = TranscriptionSegment::factory()->for($transcription)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    $editionPassage = EditionPassage::where('edition_id', $edition->id)->sole();

    $lemma = Lemma::where('canonical_passage_id', $line1->id)->sole();
    $reading = LemmaReading::where('lemma_id', $lemma->id)->sole();
    EditionLemma::create(['edition_id' => $edition->id, 'lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);

    $response = $this->delete(route('edition-passages.destroy', $editionPassage));
    $response->assertRedirect();

    expect(EditionPassage::find($editionPassage->id))->toBeNull()
        ->and(EditionLemma::where('edition_id', $edition->id)->exists())->toBeFalse()
        // Lemma/LemmaReading are edition-independent shared collation — untouched.
        ->and(Lemma::find($lemma->id))->not->toBeNull();

    // Freed up — addable again.
    $response = $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ]);
    $response->assertRedirect();
    expect(EditionPassage::where('edition_id', $edition->id)->count())->toBe(1);
});

test('a bulk add rejects a range that ends before it starts', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $line2 = citedPassage($work, 2);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first second']);
    TranscriptionSegment::factory()->for($transcription)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($transcription)->for($line2, 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 12]);

    $response = $this->post(route('edition-passages.store-bulk', $edition), [
        'transcription_layer_id' => $transcription->id,
        'from_canonical_passage_id' => $line2->id,
        'to_canonical_passage_id' => $line1->id,
    ]);

    $response->assertInvalid(['to_canonical_passage_id']);
    expect(EditionPassage::count())->toBe(0);
});

test('a bulk add rejects a transcription with no citations in this work', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $unrelated = TranscriptionLayer::factory()->create();

    $response = $this->post(route('edition-passages.store-bulk', $edition), [
        'transcription_layer_id' => $unrelated->id,
        'from_canonical_passage_id' => $line1->id,
        'to_canonical_passage_id' => $line1->id,
    ]);

    $response->assertInvalid(['transcription_layer_id']);
});

test('a guest cannot add or remove edition passages', function () {
    $this->actingAs(User::factory()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $transcription = TranscriptionLayer::factory()->create(['text' => 'first']);
    TranscriptionSegment::factory()->for($transcription)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $transcription->id,
        'start_offset' => 0,
        'end_offset' => 5,
    ])->assertForbidden();

    $this->post(route('edition-passages.store-bulk', $edition), [
        'transcription_layer_id' => $transcription->id,
        'from_canonical_passage_id' => $line1->id,
        'to_canonical_passage_id' => $line1->id,
    ])->assertForbidden();

    expect(EditionPassage::count())->toBe(0);

    $editionPassage = EditionPassage::factory()->create();
    $this->delete(route('edition-passages.destroy', $editionPassage))->assertForbidden();
});
