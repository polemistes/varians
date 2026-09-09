<?php

use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use Inertia\Testing\AssertableInertia as AssertInertia;

/** An edition with one passage added from a one-word transcription. */
function editionWithOnePassage(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $formatted = $work->referenceScheme->format(['book' => 1, 'line' => 1]);
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1],
        'sort_key' => $formatted['sort_key'],
        'label' => $formatted['label'],
    ]);
    $layer = TranscriptionLayer::factory()->create(['text' => 'word']);
    $segment = TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
    PassageAdder::add($edition, $segment, 1.0);

    return compact('work', 'edition', 'passage');
}

test('a passage of an edition cites an item, with the locator saved and editable', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithOnePassage();
    $item = BibliographyItem::factory()->create(['label' => 'Bergk 1882']);

    $this->post(route('bibliography-references.store'), [
        'bibliography_item_id' => $item->id,
        'edition_id' => $edition->id,
        'canonical_passage_id' => $passage->id,
        'postnote' => 'p. 45',
    ])->assertRedirect();

    $reference = BibliographyReference::sole();
    expect($reference->citation())->toBe('Bergk 1882, p. 45');

    $this->patch(route('bibliography-references.update', $reference), ['prenote' => 'cf.', 'postnote' => 'pp. 45–47'])->assertRedirect();
    expect($reference->fresh()->citation())->toBe('cf. Bergk 1882, pp. 45–47');

    // The edition page carries it on the passage and in its bibliography.
    $this->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->where('windowPassages.0.references.0.citation', 'cf. Bergk 1882, pp. 45–47')
            ->where('bibliography.0.label', 'Bergk 1882')
            ->has('bibliographyForm.registry.types')
            ->has('bibliographyForm.suggestions.names'));

    $this->delete(route('bibliography-references.destroy', $reference))->assertRedirect();
    expect(BibliographyReference::count())->toBe(0);
});

test('a citation names a conjecture or a passage of an edition, never both or neither', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passage' => $passage] = editionWithOnePassage();
    $item = BibliographyItem::factory()->create();
    $conjecture = Conjecture::factory()->for($passage, 'canonicalPassage')->create();

    $this->post(route('bibliography-references.store'), ['bibliography_item_id' => $item->id])
        ->assertInvalid(['conjecture_id']);
    $this->post(route('bibliography-references.store'), [
        'bibliography_item_id' => $item->id,
        'conjecture_id' => $conjecture->id,
        'edition_id' => $edition->id,
        'canonical_passage_id' => $passage->id,
    ])->assertInvalid(['conjecture_id']);

    // A passage not in the edition cannot be cited from.
    $other = CanonicalPassage::factory()->for($edition->work)->create();
    $this->post(route('bibliography-references.store'), [
        'bibliography_item_id' => $item->id,
        'edition_id' => $edition->id,
        'canonical_passage_id' => $other->id,
    ])->assertInvalid(['canonical_passage_id']);

    $this->post(route('bibliography-references.store'), [
        'bibliography_item_id' => $item->id,
        'conjecture_id' => $conjecture->id,
    ])->assertRedirect();

    expect(BibliographyReference::sole()->conjecture_id)->toBe($conjecture->id);
});

test('a new conjecture is recorded with its citations in the same request', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = editionWithOnePassage();
    $item = BibliographyItem::factory()->create(['label' => 'Dover 1972']);
    $lemma = $passage->lemmas()->sole();

    $this->post(route('edition-variants.store', $edition), [
        'canonical_passage_id' => $passage->id,
        'placement' => 'range',
        'range_start_lemma_id' => $lemma->id,
        'range_end_lemma_id' => $lemma->id,
        'source' => 'new_conjecture',
        'conjecture_type' => 'substitution',
        'conjecture_text' => 'verbum',
        'conjecture_proposed_by' => 'Dover',
        'conjecture_references' => [['item_id' => $item->id, 'postnote' => '12']],
    ])->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->references()->sole()->citation())->toBe('Dover 1972, 12');

    // ...and reaches the apparatus as a citation on the candidate, and the
    // item joins the edition's bibliography.
    $this->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->where('windowPassages.0.runs.0.candidates.1.references.0.citation', 'Dover 1972, 12')
            ->where('bibliography.0.id', $item->id));
});

test('the picker finds items by what is typed', function () {
    $this->actingAs(User::factory()->editor()->create());
    BibliographyItem::factory()->create(['label' => 'Dover 1972', 'fields' => ['author' => 'Dover, K. J.', 'title' => 'Aristophanic Comedy']]);
    BibliographyItem::factory()->create(['label' => 'Page 1962', 'fields' => ['editor' => 'Page, D. L.', 'title' => 'Poetae Melici Graeci']]);

    $this->getJson(route('bibliography.search', ['q' => 'aristoph']))
        ->assertOk()
        ->assertJsonCount(1)
        ->assertJsonPath('0.label', 'Dover 1972');
});

test('a member cites only what she may edit, and any member may search', function () {
    $member = User::factory()->create();
    $this->actingAs($member);
    $item = BibliographyItem::factory()->create();

    $this->post(route('bibliography-references.store'), ['bibliography_item_id' => $item->id, 'conjecture_id' => Conjecture::factory()->create()->id])
        ->assertForbidden();
    $this->post(route('bibliography-references.store'), ['bibliography_item_id' => $item->id, 'conjecture_id' => Conjecture::factory()->for($member)->create()->id])
        ->assertRedirect();
    expect(BibliographyReference::where('bibliography_item_id', $item->id)->count())->toBe(1);

    $this->getJson(route('bibliography.search', ['q' => 'x']))->assertOk();
});
