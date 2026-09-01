<?php

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Builds a work/edition/passage with a base transcription already added to
 * the edition (materialized via the same PassageAdder the real
 * edition-passages.store endpoint uses, so every word is a real Lemma
 * column and the base's own text already renders by default) — so every
 * test below can skip straight to the word-level decision it's actually
 * testing. `$witnessB`'s segment, when given, is created *before* the add
 * so PassageAdder's own "align every citing segment" sweep picks it up too,
 * exactly as it would for a real bulk add encountering more than one
 * witness at once.
 */
function editionWithBase(string $baseText, ?string $witnessB = null): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passage = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    // Sigla pinned: witnesses are aligned in siglum order, so leaving these
    // to the factory's random letters would let either witness build the
    // columns and make every structural assertion below a coin flip. "A" is
    // the base and so seeds them.
    $base = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => $baseText]);
    $baseSegment = TranscriptionSegment::factory()->for($base)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($baseText)]);

    $result = compact('work', 'edition', 'passage', 'base');

    if ($witnessB !== null) {
        $other = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => $witnessB]);
        TranscriptionSegment::factory()->for($other)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($witnessB)]);
        $result['other'] = $other;
    }

    $result['editionPassage'] = PassageAdder::add($edition, $baseSegment, 1.0);

    return $result;
}

/**
 * A work/edition with passage 1.1 already added (real segment, real base)
 * and passage 1.2 not created at all — for the whole-line-lacuna tests,
 * which anchor a fresh "1.1a" via `insert_after_edition_passage_id` rather
 * than relying on any base-range coverage (that mechanism doesn't exist
 * anymore — see EditionPassage).
 *
 * @return array{work: Work, edition: Edition, editionPassage: EditionPassage}
 */
function editionSpanningTwoLines(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passage = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $base = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $segment = TranscriptionSegment::factory()->for($base)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);

    $editionPassage = PassageAdder::add($edition, $segment, 1.0);

    return compact('work', 'edition', 'editionPassage');
}

test('picking a detected witness variant selects it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage, 'other' => $other] = editionWithBase('the quick fox', 'the slow fox');

    // The whole passage was already materialized (3 words) when added to
    // the edition — nothing is selected yet (the base's own text already
    // renders by default for an undecided column), picking a candidate here
    // is the first real decision.
    expect(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe(3)
        ->and(EditionLemma::where('edition_id', $edition->id)->exists())->toBeFalse();

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4,
        'base_end_offset' => 9,
        'source' => 'transcription',
        'transcription_layer_id' => $other->id,
        'start_offset' => 4,
        'end_offset' => 8,
    ]);

    $response->assertRedirect();

    $selection = EditionLemma::where('edition_id', $edition->id)->sole();
    expect($selection->selectedReading->transcription_layer_id)->toBe($other->id)
        ->and($selection->selectedReading->start_offset)->toBe(4)
        ->and($selection->selectedReading->end_offset)->toBe(8);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.decided', true)
        ->where('windowPassages.0.runs.1.text', 'slow'));
});

test('recording a fresh conjecture on a plain span catalogues it as a candidate without adopting it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4,
        'range_end_base_offset' => 9,
        'source' => 'new_conjecture',
        'conjecture_text' => 'swift',
        'conjecture_proposed_by' => 'Bentley',
    ]);

    $response->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->text)->toBe('swift')
        ->and($conjecture->proposed_by)->toBe('Bentley');

    $lemma = Lemma::whereHas('readings', fn ($q) => $q->where('conjecture_id', $conjecture->id))->sole();
    $reading = $lemma->readings->firstWhere('conjecture_id', $conjecture->id);
    expect($reading->range_end_lemma_id)->toBeNull() // a single-word range is exactly the single-column case
        ->and(EditionLemma::where('edition_id', $edition->id)->exists())->toBeFalse();
});

test('a catalogued, still-unplaced conjecture can be placed at a specific column', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');
    $conjecture = Conjecture::factory()->for($passage, 'canonicalPassage')->create(['text' => 'swift']);

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4,
        'base_end_offset' => 9,
        'source' => 'existing_conjecture',
        'conjecture_id' => $conjecture->id,
    ]);

    expect($conjecture->lemmaReadings)->toHaveCount(1);
    $lemma = $conjecture->fresh('lemmaReadings')->lemmaReadings->first()->lemma;
    $selection = EditionLemma::where('edition_id', $edition->id)->where('lemma_id', $lemma->id)->sole();
    expect($selection->selectedReading->conjecture_id)->toBe($conjecture->id);
});

test('re-visiting an already-decided column still reports the full original candidate set, not just the winner', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage, 'other' => $other] = editionWithBase('the quick fox', 'the slow fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4,
        'base_end_offset' => 9,
        'source' => 'transcription',
        'transcription_layer_id' => $other->id,
        'start_offset' => 4,
        'end_offset' => 8,
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->has('windowPassages.0.runs.1.candidates', 2)
        ->where('windowPassages.0.runs.1.candidates.0.selected', false)
        ->where('windowPassages.0.runs.1.candidates.1.selected', true));
});

test('picking the same candidate twice does not create a duplicate reading', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage, 'base' => $base] = editionWithBase('the quick fox');

    $payload = [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 0,
        'base_end_offset' => 3,
        'source' => 'transcription',
        'transcription_layer_id' => $base->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ];

    $this->post(route('edition-variants.store', $edition), $payload);
    $this->post(route('edition-variants.store', $edition), $payload);

    $lemma = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->first();
    // Still just the base's own reading — re-picking it twice never creates
    // a second reading, and the selection stays exactly one row.
    expect($lemma->readings)->toHaveCount(1)
        ->and(EditionLemma::where('edition_id', $edition->id)->where('lemma_id', $lemma->id)->count())->toBe(1);
});

test('a guest cannot add a variant to an edition', function () {
    $this->actingAs(User::factory()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');
    $lemmaCountBefore = Lemma::where('canonical_passage_id', $passage->id)->count();

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 0,
        'base_end_offset' => 3,
        'source' => 'new_conjecture',
        'conjecture_text' => 'lo',
    ]);

    $response->assertForbidden();
    expect(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe($lemmaCountBefore);
});

test('a bare lacuna is inserted between two words without replacing either of them', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'insert',
        'insert_after_base_offset' => 3,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_extent' => 'one word',
        'conjecture_proposed_by' => 'Wolf',
    ]);

    $response->assertRedirect();

    // The passage was materialized (3 words) at add time, plus the new
    // column — 4 lemmas, not 3, since the lacuna never competes with "quick".
    expect(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe(4);

    $conjecture = Conjecture::sole();
    expect($conjecture->type)->toBe(ConjectureType::Lacuna)
        ->and($conjecture->text)->toBeNull()
        ->and($conjecture->extent)->toBe('one word');

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.0.text', 'the')
        ->where('windowPassages.0.runs.1.text', '[lacuna: one word]')
        ->where('windowPassages.0.runs.1.candidates.0.label', 'lacuna — Wolf')
        ->where('windowPassages.0.runs.2.text', 'quick')
        ->where('windowPassages.0.runs.3.text', 'fox'));
});

test('a supplement proposed for an existing lacuna column can be selected in its place', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'insert',
        'insert_after_base_offset' => 3,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_proposed_by' => 'Wolf',
    ]);
    $lacuna = Conjecture::sole();
    $lemma = Lemma::whereHas('readings', fn ($q) => $q->where('conjecture_id', $lacuna->id))->sole();

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'existing',
        'lemma_id' => $lemma->id,
        'source' => 'new_conjecture',
        'conjecture_type' => 'supplement',
        'conjecture_text' => 'indeed',
        'conjecture_supplements_conjecture_id' => $lacuna->id,
        'conjecture_proposed_by' => 'Bentley',
    ]);

    $response->assertRedirect();
    $supplement = Conjecture::where('type', 'supplement')->sole();
    expect($supplement->supplements_conjecture_id)->toBe($lacuna->id);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.text', 'indeed')
        ->where('windowPassages.0.runs.1.candidates.1.label', 'suppl. — Bentley')
        ->has('windowPassages.0.runs.1.candidates', 2));
});

test('a supplement targeting a lacuna that isn\'t on the clicked column is rejected', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'insert',
        'insert_after_base_offset' => 3,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
    ]);
    $lacuna = Conjecture::sole();
    $unrelatedLemma = Lemma::where('canonical_passage_id', $passage->id)
        ->whereHas('readings', fn ($q) => $q->where('start_offset', 4))
        ->sole();

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'existing',
        'lemma_id' => $unrelatedLemma->id,
        'source' => 'new_conjecture',
        'conjecture_type' => 'supplement',
        'conjecture_text' => 'indeed',
        'conjecture_supplements_conjecture_id' => $lacuna->id,
    ]);

    $response->assertInvalid(['conjecture_id']);
});

test('a lacuna cannot be placed as if it were a witness span', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4,
        'base_end_offset' => 9,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_proposed_by' => 'Wolf',
    ]);

    $response->assertInvalid(['source']);
    expect(Conjecture::count())->toBe(0);
});

test('a witness reading cannot be used as a point insertion', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage, 'base' => $base] = editionWithBase('the quick fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'insert',
        'insert_after_base_offset' => 3,
        'source' => 'transcription',
        'transcription_layer_id' => $base->id,
        'start_offset' => 4,
        'end_offset' => 9,
    ]);

    $response->assertInvalid(['source']);
});

test('a fresh multi-word range conjecture spans several columns without changing the lemma count', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');
    // the=[0,3) swift=[4,9) red=[10,13) fox=[14,17)

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4,
        'range_end_base_offset' => 17,
        'source' => 'new_conjecture',
        'conjecture_text' => 'creature',
        'conjecture_proposed_by' => 'Bentley',
    ]);

    $response->assertRedirect();

    // The passage was already materialized as 4 word-level lemmas when
    // added to the edition — the range never merges/deletes the underlying
    // columns.
    expect(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe(4);

    $conjecture = Conjecture::sole();
    expect($conjecture->text)->toBe('creature');

    $reading = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[1]
        ->readings->firstWhere('conjecture_id', $conjecture->id);
    $endLemma = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[3];
    expect($reading->range_end_lemma_id)->toBe($endLemma->id);

    // Catalogued as a candidate, but not adopted — still 4 independent runs.
    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.0.text', 'the')
        ->where('windowPassages.0.runs.1.text', 'swift')
        ->where('windowPassages.0.runs.1.decided', false)
        ->has('windowPassages.0.runs', 4));

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 9,
        'source' => 'existing_conjecture', 'conjecture_id' => $conjecture->id,
    ]);

    $showAfterPick = $this->get(route('editions.show', [$work, $edition]));
    $showAfterPick->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.0.text', 'the')
        ->where('windowPassages.0.runs.1.text', 'creature')
        ->where('windowPassages.0.runs.1.decided', true)
        ->has('windowPassages.0.runs', 2)); // "the" + the collapsed range — not 4
});

test('authoring a covering range conjecture does not itself clear an intermediate lemma\'s individual decision', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage, 'base' => $base] = editionWithBase('the swift red fox');

    // Decide "red" (offsets [10,13)) on its own first.
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 10, 'base_end_offset' => 13,
        'source' => 'transcription', 'transcription_layer_id' => $base->id, 'start_offset' => 10, 'end_offset' => 13,
    ]);
    expect(EditionLemma::where('edition_id', $edition->id)->count())->toBe(1);

    // Merely authoring a range spanning swift..fox catalogues it, but
    // doesn't adopt it — "red"'s own decision is untouched.
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    expect(EditionLemma::where('edition_id', $edition->id)->count())->toBe(1);
});

test('adopting a covering range conjecture clears an intermediate lemma\'s individual decision', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage, 'base' => $base] = editionWithBase('the swift red fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 10, 'base_end_offset' => 13,
        'source' => 'transcription', 'transcription_layer_id' => $base->id, 'start_offset' => 10, 'end_offset' => 13,
    ]);

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);
    $conjecture = Conjecture::sole();

    // Now actually adopt it — pick it like any other candidate on its anchor.
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 9,
        'source' => 'existing_conjecture', 'conjecture_id' => $conjecture->id,
    ]);

    // Only the range's own selection remains — "red"'s individual decision was cleared.
    expect(EditionLemma::where('edition_id', $edition->id)->count())->toBe(1);
    $selection = EditionLemma::where('edition_id', $edition->id)->sole();
    expect($selection->selectedReading->conjecture->text)->toBe('creature');
});

test('picking a normal candidate for a lemma inside an active range breaks the range', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage, 'base' => $base] = editionWithBase('the swift red fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);
    $conjecture = Conjecture::sole();
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 9,
        'source' => 'existing_conjecture', 'conjecture_id' => $conjecture->id,
    ]);
    expect(EditionLemma::where('edition_id', $edition->id)->count())->toBe(1);

    // Now pick a normal candidate for "red" directly, inside the range.
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 10, 'base_end_offset' => 13,
        'source' => 'transcription', 'transcription_layer_id' => $base->id, 'start_offset' => 10, 'end_offset' => 13,
    ]);

    // Only "red"'s own selection remains — the range was broken.
    $selections = EditionLemma::where('edition_id', $edition->id)->with('lemma')->get();
    expect($selections)->toHaveCount(1)
        ->and($selections->first()->selectedReading->start_offset)->toBe(10);
});

test('a competing range proposal for the exact same span appears as a candidate on re-render', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');

    $payload = [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4,
        'range_end_base_offset' => 17,
        'source' => 'new_conjecture',
    ];

    $this->post(route('edition-variants.store', $edition), [...$payload, 'conjecture_text' => 'creature']);
    $this->post(route('edition-variants.store', $edition), [...$payload, 'conjecture_text' => 'beast']);
    $beast = Conjecture::where('text', 'beast')->sole();

    // Neither is adopted just by being authored — pick one, like any other
    // candidate on its anchor.
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 9,
        'source' => 'existing_conjecture', 'conjecture_id' => $beast->id,
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.text', 'beast')
        // The anchor lemma's own plain base-witness reading ("swift") plus
        // both range-shaped proposals — candidates are unfiltered by shape.
        ->has('windowPassages.0.runs.1.candidates', 3));
});

test('removing a range via edition-lemmas.destroy reverts the passage to per-word rendering', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    $startLemma = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[1];
    $this->delete(route('edition-lemmas.destroy', [$edition, $startLemma]));

    expect(EditionLemma::where('edition_id', $edition->id)->count())->toBe(0);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->has('windowPassages.0.runs', 4) // the / swift / red / fox — independent again
        ->where('windowPassages.0.runs.1.range_end_lemma_id', null)
        ->where('windowPassages.0.runs.1.decided', false));
});

test('a witness reading can be placed as a range when its neighbours have nothing else to merge it from', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage, 'base' => $base] = editionWithBase('the swift red fox');

    // First, a competing conjecture over the same span — this is what makes
    // the base's own "swift red fox" a genuine alternative worth adopting
    // as a range in its own right (see EditionController::witnessExtension).
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    $startLemma = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[1];
    $endLemma = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[3];

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_lemma_id' => $startLemma->id,
        'range_end_lemma_id' => $endLemma->id,
        'source' => 'transcription', 'transcription_layer_id' => $base->id, 'start_offset' => 4, 'end_offset' => 17,
    ]);

    $response->assertRedirect();

    $reading = LemmaReading::where('lemma_id', $startLemma->id)
        ->where('transcription_layer_id', $base->id)
        ->where('start_offset', 4)->where('end_offset', 17)
        ->sole();
    expect($reading->range_end_lemma_id)->toBe($endLemma->id);

    $selection = EditionLemma::where('edition_id', $edition->id)->sole();
    expect($selection->selected_reading_id)->toBe($reading->id);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.text', 'swift red fox')
        ->where('windowPassages.0.runs.1.decided', true));
});

test('re-placing an already-persisted witness range does not create a duplicate reading', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage, 'base' => $base] = editionWithBase('the swift red fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    $payload = [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'transcription', 'transcription_layer_id' => $base->id, 'start_offset' => 4, 'end_offset' => 17,
    ];

    $this->post(route('edition-variants.store', $edition), $payload);
    $countAfterFirst = LemmaReading::count();

    $this->post(route('edition-variants.store', $edition), $payload);

    expect(LemmaReading::count())->toBe($countAfterFirst);
});

test('a lacuna cannot be placed as a range', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_type' => 'lacuna',
    ]);

    $response->assertInvalid(['conjecture_type']);
});

test('a range whose end comes before its start is rejected', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 10, // "red"
        'range_end_base_offset' => 9, // "swift" ends before "red" even starts
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    $response->assertInvalid(['range_end_base_offset']);
});

test('a range of exactly one word is allowed and stored without a range_end_lemma_id', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4,
        'range_end_base_offset' => 9, // exactly "swift" itself — the single-word case
        'source' => 'new_conjecture', 'conjecture_text' => 'nimble',
    ]);

    $response->assertRedirect();

    $conjecture = Conjecture::sole();
    $reading = LemmaReading::where('conjecture_id', $conjecture->id)->sole();
    expect($reading->range_end_lemma_id)->toBeNull();

    // Catalogued as a candidate, but not adopted — the run still shows the
    // base's own word.
    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.text', 'swift')
        ->where('windowPassages.0.runs.1.decided', false)
        ->has('windowPassages.0.runs.1.candidates', 2)
        ->has('windowPassages.0.runs', 4)); // still 4 independent runs, not collapsed

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 9,
        'source' => 'existing_conjecture', 'conjecture_id' => $conjecture->id,
    ]);

    $showAfterPick = $this->get(route('editions.show', [$work, $edition]));
    $showAfterPick->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.text', 'nimble')
        ->where('windowPassages.0.runs.1.range_end_lemma_id', null)
        ->has('windowPassages.0.runs', 4));
});

test('a brand new substitution can no longer be placed via ordinary placement=existing', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4,
        'base_end_offset' => 9,
        'source' => 'new_conjecture',
        'conjecture_text' => 'swift',
    ]);

    $response->assertInvalid(['placement']);
    expect(Conjecture::count())->toBe(0);
});

test('a range-shaped candidate reports the original span it would replace, not just its own proposed text', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        // The anchor's own plain base reading carries no replaced_text (it's
        // not itself a substitution) but is extended to its own full
        // competing span — see EditionController::witnessExtension — so an
        // editor compares "swift red fox" against "creature", not a
        // misleading "swift" against "creature".
        ->where('windowPassages.0.runs.1.candidates.0.text', 'swift red fox')
        ->where('windowPassages.0.runs.1.candidates.0.replaced_text', null)
        ->where('windowPassages.0.runs.1.candidates.0.end_offset', 17)
        ->where('windowPassages.0.runs.1.candidates.1.text', 'creature')
        ->where('windowPassages.0.runs.1.candidates.1.replaced_text', 'swift red fox'));
});

test('each manuscript\'s own reading extends to its own full competing span, even when they disagree', function () {
    $this->actingAs(User::factory()->editor()->create());
    // A reads "swift red fox"; B reads "nimble red fox" — they diverge only
    // on the first word, so PassageAligner never had cause to merge either
    // one into a range at materialization time.
    ['work' => $work, 'edition' => $edition, 'passage' => $passage, 'other' => $other] =
        editionWithBase('the swift red fox', 'the nimble red fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.candidates.0.text', 'swift red fox')
        ->where('windowPassages.0.runs.1.candidates.1.text', 'nimble red fox')
        ->where('windowPassages.0.runs.1.candidates.2.text', 'creature'));

    expect($other)->not->toBeNull();
});

test('a fragmentary witness that does not reach as far as a competing range is left unextended', function () {
    $this->actingAs(User::factory()->editor()->create());
    // B only cites "swift" itself — it has no reading at all for "red"/"fox",
    // so there is nothing honest to extend its candidate to.
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $passage = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $base = TranscriptionLayer::factory()->create(['text' => 'the swift red fox']);
    $baseSegment = TranscriptionSegment::factory()->for($base)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 18]);
    $fragment = TranscriptionLayer::factory()->create(['text' => 'swift']);
    TranscriptionSegment::factory()->for($fragment)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 5]);

    PassageAdder::add($edition, $baseSegment, 1.0);

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.candidates.0.text', 'swift red fox') // base, extended
        ->where('windowPassages.0.runs.1.candidates.1.text', 'swift') // fragment, left as-is
        ->where('windowPassages.0.runs.1.candidates.1.range_end_lemma_id', null));
});

test('picking a PassageAligner-detected multi-word witness variant selects the merged reading via ordinary placement=existing', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage, 'other' => $other] =
        editionWithBase('the fox sleeps', 'the exceedingly swift creature sleeps');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 7, // "fox"
        'source' => 'transcription',
        'transcription_layer_id' => $other->id,
        'start_offset' => 4, 'end_offset' => 30, // "exceedingly swift creature"
    ]);

    $response->assertRedirect();
    expect(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe(3);

    $selection = EditionLemma::where('edition_id', $edition->id)->sole();
    expect($selection->selectedReading->range_end_lemma_id)->toBeNull() // only one existing lemma involved
        ->and($selection->selectedReading->start_offset)->toBe(4)
        ->and($selection->selectedReading->end_offset)->toBe(30);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.decided', true)
        ->where('windowPassages.0.runs.1.text', 'exceedingly swift creature'));
});

test('re-selecting an already-persisted range-shaped witness reading does not create a duplicate', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage, 'other' => $other] =
        editionWithBase('the swift fox sleeps', 'the creature very quickly sleeps');

    $payload = [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 13, // "swift fox"
        'source' => 'transcription',
        'transcription_layer_id' => $other->id,
        'start_offset' => 4, 'end_offset' => 25, // "creature very quickly"
    ];

    $this->post(route('edition-variants.store', $edition), $payload);
    $countAfterFirst = LemmaReading::count();

    $this->post(route('edition-variants.store', $edition), $payload); // re-select the same candidate

    expect(LemmaReading::count())->toBe($countAfterFirst);
});

test('a witness-sourced range run renders the witness\'s own text, not a conjecture placeholder', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage, 'other' => $other] =
        editionWithBase('the swift fox sleeps', 'the creature very quickly sleeps');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 13,
        'source' => 'transcription', 'transcription_layer_id' => $other->id,
        'start_offset' => 4, 'end_offset' => 25,
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.text', 'creature very quickly')
        ->where('windowPassages.0.runs.1.range_end_lemma_id', fn ($id) => $id !== null));
});

test('a passage fully covered by one range reports complete status, not stuck at partial', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the swift red fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 0, 'range_end_base_offset' => 3,
        'source' => 'new_conjecture', 'conjecture_text' => 'lo',
    ]);
    $first = Conjecture::sole();
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 0, 'base_end_offset' => 3,
        'source' => 'existing_conjecture', 'conjecture_id' => $first->id,
    ]);

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_base_offset' => 4, 'range_end_base_offset' => 17,
        'source' => 'new_conjecture', 'conjecture_text' => 'creature',
    ]);
    $second = Conjecture::where('text', 'creature')->sole();
    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4, 'base_end_offset' => 9,
        'source' => 'existing_conjecture', 'conjecture_id' => $second->id,
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('passages.0.status', 'complete'));
});

test('a whole-line lacuna creates its own passage and auto-selects', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'editionPassage' => $editionPassage] = editionSpanningTwoLines();

    $response = $this->post(route('edition-variants.store', $edition), [
        'placement' => 'new_passage',
        'label' => '1.1a',
        'insert_after_edition_passage_id' => $editionPassage->id,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_extent' => 'two lines',
        'conjecture_extent_characters' => 40,
        'conjecture_proposed_by' => 'Wolf',
    ]);

    $response->assertRedirect();

    $passage = CanonicalPassage::where('work_id', $work->id)->where('label', '1.1a')->sole();
    expect($passage->address)->toBe(['book' => 1, 'line' => '1a'])
        ->and(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe(1);

    $conjecture = Conjecture::sole();
    expect($conjecture->type)->toBe(ConjectureType::Lacuna)
        ->and($conjecture->extent_characters)->toBe(40);

    $lemma = Lemma::where('canonical_passage_id', $passage->id)->sole();
    $selection = EditionLemma::where('edition_id', $edition->id)->where('lemma_id', $lemma->id)->sole();
    expect($selection->selectedReading->conjecture_id)->toBe($conjecture->id);

    // Positioned after 1.1, as anchored.
    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('passages.0.label', '1.1')
        ->where('passages.1.label', '1.1a'));
});

test('a whole-line lacuna passage is only ever created for a lacuna, never another conjecture type', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'editionPassage' => $editionPassage] = editionSpanningTwoLines();

    $response = $this->post(route('edition-variants.store', $edition), [
        'placement' => 'new_passage',
        'label' => '1.1a',
        'insert_after_edition_passage_id' => $editionPassage->id,
        'source' => 'new_conjecture',
        'conjecture_type' => 'substitution',
        'conjecture_text' => 'not a lacuna',
    ]);

    $response->assertInvalid(['conjecture_type']);
    expect(CanonicalPassage::where('label', '1.1a')->exists())->toBeFalse();
});

test('repeating a whole-line lacuna label reuses the same passage instead of duplicating it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'editionPassage' => $editionPassage] = editionSpanningTwoLines();

    $payload = [
        'placement' => 'new_passage',
        'label' => '1.1a',
        'insert_after_edition_passage_id' => $editionPassage->id,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_proposed_by' => 'Wolf',
    ];

    $this->post(route('edition-variants.store', $edition), $payload);
    $this->post(route('edition-variants.store', $edition), [...$payload, 'conjecture_proposed_by' => 'Bentley']);

    expect(CanonicalPassage::where('work_id', $work->id)->where('label', '1.1a')->count())->toBe(1);
    $passage = CanonicalPassage::where('work_id', $work->id)->where('label', '1.1a')->sole();
    // Both proposals land on the passage's one lemma as competing readings —
    // the second author auto-selects, same as any other lacuna.
    expect(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe(1);
    $lemma = Lemma::where('canonical_passage_id', $passage->id)->sole();
    expect($lemma->readings)->toHaveCount(2);
});

test('extent_characters flows through to the rendered run and candidate, and is null when never set', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'insert',
        'insert_after_base_offset' => 3,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_extent_characters' => 12,
        'conjecture_proposed_by' => 'Wolf',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.extent_characters', 12)
        ->where('windowPassages.0.runs.1.candidates.0.extent_characters', 12)
        ->where('windowPassages.0.runs.0.extent_characters', null));
});

test('a lacuna authored without extent_characters still renders the old bracketed text unregressed', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'insert',
        'insert_after_base_offset' => 3,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_extent' => 'one word',
        'conjecture_proposed_by' => 'Wolf',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.runs.1.extent_characters', null)
        ->where('windowPassages.0.runs.1.text', '[lacuna: one word]'));
});

test('a whole-line lacuna at an ordinary canonical number, never attested by any witness, reports complete rather than stuck at partial', function () {
    $this->actingAs(User::factory()->editor()->create());
    // Some lacunas were already part of the canonical numbering before any
    // transcription existed (the loss was noticed, and given a normal line
    // number, long before this edition) — "3.34" here, never cited by any
    // witness at all, as opposed to an inserted "80A"-style label for a
    // lacuna discovered later.
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $p33 = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 3, 'line' => 33], 'sort_key' => '00000003.00000033', 'label' => '3.33']);
    $base = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $segment = TranscriptionSegment::factory()->for($base)->for($p33, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);
    $editionPassage = PassageAdder::add($edition, $segment, 1.0);

    $this->post(route('edition-variants.store', $edition), [
        'placement' => 'new_passage',
        'label' => '3.34',
        'insert_after_edition_passage_id' => $editionPassage->id,
        'source' => 'new_conjecture',
        'conjecture_type' => 'lacuna',
        'conjecture_extent' => 'one line',
        'conjecture_proposed_by' => 'Ancient scribe',
    ])->assertRedirect();

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('passages.1.label', '3.34')
        ->where('passages.1.status', 'complete'));
});

test('a transposition cannot be placed through the word-level variant endpoint', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithBase('the quick fox');

    $response = $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'base_start_offset' => 4,
        'base_end_offset' => 9,
        'source' => 'new_conjecture',
        'conjecture_type' => 'transposition',
        'conjecture_proposed_by' => 'Bentley',
    ]);

    $response->assertInvalid(['conjecture_type']);
    expect(Conjecture::count())->toBe(0);
});
