<?php

use App\Enums\ConjectureType;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\EditionPassageOrder;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Support\Edition\PassageAdder;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Adds two cited passages to the edition, in citation order, each backed by
 * its own throwaway transcription/segment — mirrors
 * EditionTranspositionControllerTest's addPassagesToEdition(), scaled down
 * since these tests only ever need a single pair. `line1` always ends up as
 * the range's start (lower position), `line2` as its end.
 */
function editionWithTwoPassages(): array
{
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $line2 = citedPassage($work, 2);

    foreach ([$line1, $line2] as $index => $line) {
        $transcription = TranscriptionLayer::factory()->create(['text' => 'word']);
        $segment = TranscriptionSegment::factory()->for($transcription)->for($line, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
        PassageAdder::add($edition, $segment, (float) ($index + 1));
    }

    return compact('work', 'edition', 'line1', 'line2');
}

test('choosing a witness order requires that witness to cite every passage in the range', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'line1' => $line1, 'line2' => $line2] = editionWithTwoPassages();

    // Cites only line2, not line1 — has no whole-range order to follow.
    $partial = TranscriptionLayer::factory()->create(['text' => 'word']);
    TranscriptionSegment::factory()->for($partial)->for($line2, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);

    $response = $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line2->id,
        'transcription_layer_id' => $partial->id,
    ]);

    $response->assertInvalid(['transcription_layer_id']);
    expect(EditionPassageOrder::count())->toBe(0);
});

test('choosing a conjecture requires its proposed set to match the range exactly', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'line1' => $line1, 'line2' => $line2] = editionWithTwoPassages();

    // Only proposes an order for line2 — not the whole [line1, line2] range.
    $conjecture = Conjecture::factory()->reordering()->create();
    ConjectureOrderingEntry::factory()->create(['conjecture_id' => $conjecture->id, 'canonical_passage_id' => $line2->id, 'sequence' => 0]);

    $response = $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line2->id,
        'conjecture_id' => $conjecture->id,
    ]);

    $response->assertInvalid(['conjecture_id']);
    expect(EditionPassageOrder::count())->toBe(0);
});

test('choosing the same range again updates the existing choice rather than duplicating it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'line1' => $line1, 'line2' => $line2] = editionWithTwoPassages();

    $witnessA = TranscriptionLayer::factory()->create(['text' => 'first second']);
    TranscriptionSegment::factory()->for($witnessA)->for($line1, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($witnessA)->for($line2, 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 12]);

    $witnessB = TranscriptionLayer::factory()->create(['text' => 'second first']);
    TranscriptionSegment::factory()->for($witnessB)->for($line2, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 6]);
    TranscriptionSegment::factory()->for($witnessB)->for($line1, 'canonicalPassage')->create(['start_offset' => 7, 'end_offset' => 12]);

    $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line2->id,
        'transcription_layer_id' => $witnessA->id,
    ]);
    $first = EditionPassageOrder::sole();

    // Re-decide the very same range — the exact scenario that used to pile
    // up a fresh Conjecture/EditionTransposition every time (see the real
    // Lysistrata incident in EditionTranspositionControllerTest).
    $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line2->id,
        'transcription_layer_id' => $witnessB->id,
    ]);

    $second = EditionPassageOrder::sole();
    expect($second->id)->toBe($first->id)
        ->and($second->transcription_layer_id)->toBe($witnessB->id);
});

test('choosing a catalogued reordering conjecture selects it, never creating a new one', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'line1' => $line1, 'line2' => $line2] = editionWithTwoPassages();

    $conjecture = Conjecture::factory()->reordering()->create(['proposed_by' => 'Bergk']);
    ConjectureOrderingEntry::factory()->create(['conjecture_id' => $conjecture->id, 'canonical_passage_id' => $line2->id, 'sequence' => 0]);
    ConjectureOrderingEntry::factory()->create(['conjecture_id' => $conjecture->id, 'canonical_passage_id' => $line1->id, 'sequence' => 1]);

    $response = $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line2->id,
        'conjecture_id' => $conjecture->id,
    ]);

    $response->assertRedirect();

    $order = EditionPassageOrder::sole();
    expect($order->conjecture_id)->toBe($conjecture->id)
        ->and($order->transcription_layer_id)->toBeNull()
        ->and(Conjecture::where('type', ConjectureType::Reordering)->count())->toBe(1);
});

test('destroying a witness order choice reverts to the natural order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'line1' => $line1, 'line2' => $line2] = editionWithTwoPassages();

    $witness = TranscriptionLayer::factory()->create(['text' => 'second first']);
    TranscriptionSegment::factory()->for($witness)->for($line2, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 6]);
    TranscriptionSegment::factory()->for($witness)->for($line1, 'canonicalPassage')->create(['start_offset' => 7, 'end_offset' => 12]);

    $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line2->id,
        'transcription_layer_id' => $witness->id,
    ]);
    $order = EditionPassageOrder::sole();

    $moved = $this->get(route('editions.show', [$work, $edition]));
    $moved->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $line2->label)
        ->where('windowPassages.1.label', $line1->label));

    $response = $this->delete(route('edition-passage-orders.destroy', $order));
    $response->assertRedirect();
    expect(EditionPassageOrder::count())->toBe(0);

    $reverted = $this->get(route('editions.show', [$work, $edition]));
    $reverted->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $line1->label)
        ->where('windowPassages.1.label', $line2->label));
});

test('a settled range of more than two passages still shows as settled even though resequencing moved a different passage to the boundary', function () {
    // A real bug: comparing the *current* boundary passages against the
    // stored range_start/range_end (as the old two-passage-only version
    // did) breaks the moment a 3+ passage range is resequenced, since
    // resequencing can put *any* passage at the new lowest/highest
    // position, not just swap between the original two boundary passages.
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionForPassages();
    $line1 = citedPassage($work, 1);
    $line2 = citedPassage($work, 2);
    $line3 = citedPassage($work, 3);

    foreach ([$line1, $line2, $line3] as $index => $line) {
        $transcription = TranscriptionLayer::factory()->create(['text' => 'word']);
        $segment = TranscriptionSegment::factory()->for($transcription)->for($line, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
        PassageAdder::add($edition, $segment, (float) ($index + 1));
    }

    // Witness G reads the three lines as 3, 1, 2 — line1 (the range's
    // original start) ends up in the *middle*, not at either boundary.
    $witnessG = TranscriptionLayer::factory()->create(['text' => 'three one two']);
    TranscriptionSegment::factory()->for($witnessG)->for($line3, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($witnessG)->for($line1, 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 9]);
    TranscriptionSegment::factory()->for($witnessG)->for($line2, 'canonicalPassage')->create(['start_offset' => 10, 'end_offset' => 13]);

    $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line3->id,
        'transcription_layer_id' => $witnessG->id,
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $line3->label)
        ->where('windowPassages.1.label', $line1->label)
        ->where('windowPassages.2.label', $line2->label)
        // All three, not just the resequenced middle passage — a span
        // computed only from the two originally-named boundary passages'
        // current array indices misses whichever passage now sits at the
        // true extreme, so this must hold at every index in the range.
        ->where('windowPassages.0.order_range.edition_passage_order_id', fn ($id) => $id !== null)
        ->where('windowPassages.1.order_range.edition_passage_order_id', fn ($id) => $id !== null)
        ->where('windowPassages.2.order_range.edition_passage_order_id', fn ($id) => $id !== null)
        ->where('windowPassages.1.order_range.candidates', function ($candidates) use ($witnessG) {
            $bySiglum = collect($candidates)->keyBy('transcription_layer_id');

            return $bySiglum->get($witnessG->id)['matches_current'] === true;
        }));
});

test('a guest cannot choose or remove a witness order', function () {
    $this->actingAs(User::factory()->create());
    ['edition' => $edition, 'line1' => $line1, 'line2' => $line2] = editionWithTwoPassages();

    $witness = TranscriptionLayer::factory()->create(['text' => 'second first']);
    TranscriptionSegment::factory()->for($witness)->for($line2, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 6]);
    TranscriptionSegment::factory()->for($witness)->for($line1, 'canonicalPassage')->create(['start_offset' => 7, 'end_offset' => 12]);

    $this->post(route('edition-passage-orders.store', $edition), [
        'range_start_canonical_passage_id' => $line1->id,
        'range_end_canonical_passage_id' => $line2->id,
        'transcription_layer_id' => $witness->id,
    ])->assertForbidden();

    expect(EditionPassageOrder::count())->toBe(0);

    $order = EditionPassageOrder::factory()->create();
    $this->delete(route('edition-passage-orders.destroy', $order))->assertForbidden();
});
