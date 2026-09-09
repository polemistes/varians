<?php

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use App\Support\Edition\PassageOrderRewriter;
use Illuminate\Support\Collection as SupportCollection;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Adds $count canonical passages (book 1, lines 1..$count) to the edition,
 * each backed by its own throwaway transcription/segment — establishing a
 * real EditionPassage.position order (line 1 added first, etc.) for the
 * order tests to move around (PassageOrderRewriter::moveRange stands in
 * for the editor's cut and paste). Every test below needs its referenced
 * passages built this way, not as bare CanonicalPassage rows.
 *
 * @return SupportCollection<int, CanonicalPassage>
 */
function addPassagesToEdition(Work $work, Edition $edition, int $count): SupportCollection
{
    return collect(range(1, $count))->map(function (int $line) use ($work, $edition) {
        $formatted = $work->referenceScheme->format(['book' => 1, 'line' => $line]);
        $passage = CanonicalPassage::factory()->for($work)->create([
            'address' => ['book' => 1, 'line' => $line],
            'sort_key' => $formatted['sort_key'],
            'label' => $formatted['label'],
        ]);
        $transcription = TranscriptionLayer::factory()->create(['text' => 'word']);
        $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
        PassageAdder::add($edition, $segment, (float) $line);

        return $passage;
    });
}

test('a moved range sits before its target, keeping each passage\'s own label', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 4);

    // Move passage 4 to sit before passage 2: natural order 1,2,3,4 becomes 1,4,2,3.
    PassageOrderRewriter::moveRange($edition, $passages[3]->id, $passages[3]->id, $passages[1]->id, 'before');

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('passages.0.label', $passages[0]->label)
        ->where('passages.1.label', $passages[3]->label)
        ->where('passages.2.label', $passages[1]->label)
        ->where('passages.3.label', $passages[2]->label));
});

test('moving a range of more than one passage keeps them together and in order', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 4);

    // Move the range [2,3] to after passage 4: natural order 1,2,3,4 becomes 1,4,2,3.
    PassageOrderRewriter::moveRange($edition, $passages[1]->id, $passages[2]->id, $passages[3]->id, 'after');

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('passages.0.label', $passages[0]->label)
        ->where('passages.1.label', $passages[3]->label)
        ->where('passages.2.label', $passages[1]->label)
        ->where('passages.3.label', $passages[2]->label));
});

test('an unadopted transposition leaves the edition\'s passage order untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 2);

    // Catalogued but never adopted for this edition.
    Conjecture::factory()->transposition()->create([
        'canonical_passage_id' => $passages[1]->id,
        'move_target_canonical_passage_id' => $passages[0]->id,
        'move_position' => 'before',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('passages.0.label', $passages[0]->label)
        ->where('passages.1.label', $passages[1]->label));
});

test('removing a passage from the edition leaves an adopted transposition about it untouched, not deleted', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 2);

    // The editor registers 2 before 1 as a conjecture and follows it.
    $this->post(route('conjecture-orderings.store', $edition), [
        'canonical_passage_ids' => [$passages[1]->id, $passages[0]->id],
        'proposed_by' => 'Bentley',
    ])->assertRedirect();
    $adoption = EditionTransposition::sole();

    $editionPassage = EditionPassage::where('edition_id', $edition->id)
        ->where('canonical_passage_id', $passages[1]->id)
        ->sole();
    $this->delete(route('edition-passages.destroy', $editionPassage));

    // A transposition is a Conjecture, part of a reusable stockpile — its
    // adoption is never entangled with any one edition's own passage
    // lifecycle, even when the passage it names is removed.
    expect(EditionTransposition::find($adoption->id))->not->toBeNull();
});

test('a witness whose own physical order disagrees is flagged with the whole shared range', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 3);

    // Witness B cites the same passages 2 and 3, but has 3 physically
    // before 2 — the opposite of the edition's current order.
    $witnessB = TranscriptionLayer::factory()->create(['text' => 'gamma beta']);
    TranscriptionSegment::factory()->for($witnessB)->for($passages[2], 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($witnessB)->for($passages[1], 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 10]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    // Every passage in the shared range carries the *same* range info —
    // not just the ones that individually differ from a neighbor — since a
    // reader hovering any single one of them needs the whole block's story.
    // Candidates are keyed by source, not index: citation order is now
    // always listed as a candidate too.
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.order_range', null)
        ->where('windowPassages.1.order_range.candidates', function ($candidates) use ($witnessB, $passages) {
            $witness = collect($candidates)->firstWhere('transcription_layer_id', $witnessB->id);

            return $witness !== null
                && $witness['witness_siglum'] === $witnessB->witness->siglum
                && $witness['sequence'] === [$passages[2]->label, $passages[1]->label]
                && $witness['matches_current'] === false;
        })
        ->where('windowPassages.2.order_range.candidates', fn ($candidates) => collect($candidates)->firstWhere('transcription_layer_id', $witnessB->id) !== null));
});

test('no order range when a witness agrees or only cites one passage of the pair', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 2);

    $agreeing = TranscriptionLayer::factory()->create(['text' => 'alpha beta']);
    TranscriptionSegment::factory()->for($agreeing)->for($passages[0], 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($agreeing)->for($passages[1], 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 10]);

    $fragmentary = TranscriptionLayer::factory()->create(['text' => 'gamma']);
    TranscriptionSegment::factory()->for($fragmentary)->for($passages[1], 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.1.order_range', null));
});

test('a draft witness\'s order disagreement is only visible to an editor', function () {
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->published()->create();
    $passages = addPassagesToEdition($work, $edition, 2);

    // Draft by default (TranscriptionLayerFactory) — must not leak its order to
    // a non-editor viewer, exactly like its text/segments already don't.
    $draftWitness = TranscriptionLayer::factory()->create(['text' => 'beta alpha']);
    TranscriptionSegment::factory()->for($draftWitness)->for($passages[1], 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
    TranscriptionSegment::factory()->for($draftWitness)->for($passages[0], 'canonicalPassage')->create(['start_offset' => 5, 'end_offset' => 10]);

    $this->actingAs(User::factory()->editor()->create());
    $asEditor = $this->get(route('editions.show', [$work, $edition]));
    $asEditor->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.1.order_range.candidates', fn ($candidates) => collect($candidates)->firstWhere('transcription_layer_id', $draftWitness->id) !== null));

    $this->actingAs(User::factory()->create());
    $asGuest = $this->get(route('editions.show', [$work, $edition]));
    $asGuest->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.1.order_range', null));
});

test('applying a witness\'s order rewrites the stored positions and creates no Conjecture', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 2);

    $witnessB = TranscriptionLayer::factory()->create(['text' => 'beta alpha']);
    TranscriptionSegment::factory()->for($witnessB)->for($passages[1], 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
    TranscriptionSegment::factory()->for($witnessB)->for($passages[0], 'canonicalPassage')->create(['start_offset' => 5, 'end_offset' => 10]);

    $before = $this->get(route('editions.show', [$work, $edition]));
    $before->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.1.order_range.candidates', fn ($candidates) => collect($candidates)->firstWhere('transcription_layer_id', $witnessB->id) !== null));

    // Follow witness B's order — never a scholarly transposition, since the
    // manuscript itself is the source, not a proposer to name; and no
    // attribution record either, "matches witness B" being derivable.
    $this->post(route('edition-order.apply', $edition), [
        'range_start_canonical_passage_id' => $passages[0]->id,
        'range_end_canonical_passage_id' => $passages[1]->id,
        'transcription_layer_id' => $witnessB->id,
    ])->assertRedirect();

    expect(Conjecture::count())->toBe(0)
        ->and(EditionTransposition::count())->toBe(0);

    // The stored positions ARE the new order.
    $stored = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->pluck('canonical_passage_id')->all();
    expect($stored)->toBe([$passages[1]->id, $passages[0]->id]);

    $after = $this->get(route('editions.show', [$work, $edition]));
    $after->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $passages[1]->label)
        ->where('windowPassages.1.label', $passages[0]->label));
});

test('the order report is a calm derived statement: applying one source honestly keeps listing the other\'s disagreement', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passages = addPassagesToEdition($work, $edition, 2); // edition order: A, B

    $witnessQ = TranscriptionLayer::factory()->create(['text' => 'alpha beta']);
    TranscriptionSegment::factory()->for($witnessQ)->for($passages[0], 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($witnessQ)->for($passages[1], 'canonicalPassage')->create(['start_offset' => 6, 'end_offset' => 10]);

    $witnessR = TranscriptionLayer::factory()->create(['text' => 'beta alpha']);
    TranscriptionSegment::factory()->for($witnessR)->for($passages[1], 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
    TranscriptionSegment::factory()->for($witnessR)->for($passages[0], 'canonicalPassage')->create(['start_offset' => 5, 'end_offset' => 10]);

    // Witness R disagrees with the initial order (A, B); Q agrees.
    $before = $this->get(route('editions.show', [$work, $edition]));
    $before->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.1.order_range.candidates', function ($candidates) use ($witnessQ, $witnessR) {
            $byLayer = collect($candidates)->keyBy('transcription_layer_id');

            return $byLayer->get($witnessR->id)['matches_current'] === false
                && $byLayer->get($witnessQ->id)['matches_current'] === true;
        }));

    // Follow R's order: B before A.
    $this->post(route('edition-order.apply', $edition), [
        'range_start_canonical_passage_id' => $passages[0]->id,
        'range_end_canonical_passage_id' => $passages[1]->id,
        'transcription_layer_id' => $witnessR->id,
    ]);

    // The historical flip-flop incident (a Lysistrata edition accumulated
    // six adopted transpositions flipping the same pair) cannot recur:
    // there is no "unsettled" state prompting action — the report simply
    // states, calmly, that Q orders this differently and R matches. The
    // stored positions are the decision.
    $after = $this->get(route('editions.show', [$work, $edition]));
    $after->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $passages[1]->label)
        ->where('windowPassages.1.label', $passages[0]->label)
        ->where('windowPassages.1.order_range.candidates', function ($candidates) use ($witnessQ, $witnessR) {
            $byLayer = collect($candidates)->keyBy('transcription_layer_id');

            return $byLayer->get($witnessR->id)['matches_current'] === true
                && $byLayer->get($witnessQ->id)['matches_current'] === false;
        }));
});
