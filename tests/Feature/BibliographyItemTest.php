<?php

use App\Models\BibliographyItem;
use App\Models\BibliographyReference;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\TranscriptionLayer;
use App\Models\User;
use Inertia\Testing\AssertableInertia as AssertInertia;

test('everyone can read the bibliography, editors see the registry for the form', function () {
    BibliographyItem::factory()->create(['label' => 'Bergk 1882']);

    $this->get(route('bibliography.index'))
        ->assertOk()
        ->assertInertia(fn (AssertInertia $page) => $page
            ->component('Bibliography/Index')
            ->has('items', 1)
            ->where('items.0.label', 'Bergk 1882')
            ->has('registry.types')
            ->has('registry.fields')
            ->has('registry.standard.article'));
});

test('an editor adds an item; key and label are derived from author and year', function () {
    $this->actingAs(User::factory()->editor()->create());

    $this->post(route('bibliography.store'), [
        'entry_type' => 'article',
        'fields' => [
            'author' => 'Wilamowitz-Moellendorff, Ulrich von',
            'title' => 'Lesefrüchte',
            'journaltitle' => 'Hermes',
            'date' => '1927',
            'pages' => '276--298',
            'note' => '',
        ],
    ])->assertRedirect()->assertSessionHas('created_bibliography_item_id');

    $item = BibliographyItem::sole();
    expect($item->citation_key)->toBe('wilamowitzmoellendorff1927')
        ->and($item->label)->toBe('Wilamowitz-Moellendorff 1927')
        ->and($item->fields)->toBe([
            'author' => 'Wilamowitz-Moellendorff, Ulrich von',
            'title' => 'Lesefrüchte',
            'journaltitle' => 'Hermes',
            'pages' => '276--298',
            'date' => '1927',
        ]);
});

test('two works of one author and year get distinct labels and keys', function () {
    $this->actingAs(User::factory()->editor()->create());

    foreach (['One', 'Two'] as $title) {
        $this->post(route('bibliography.store'), [
            'entry_type' => 'book',
            'fields' => ['author' => 'Henderson, Jeffrey', 'title' => $title, 'date' => '1987'],
        ])->assertRedirect();
    }

    expect(BibliographyItem::pluck('label')->all())->toBe(['Henderson 1987', 'Henderson 1987a'])
        ->and(BibliographyItem::pluck('citation_key')->all())->toBe(['henderson1987', 'henderson1987a']);
});

test('only biblatex fields with balanced braces are accepted, and a title is required', function () {
    $this->actingAs(User::factory()->editor()->create());

    $this->post(route('bibliography.store'), [
        'entry_type' => 'book',
        'fields' => ['author' => 'Page, D. L.', 'journal' => 'CQ', 'title' => 'Unbalanced {brace'],
    ])->assertInvalid(['fields', 'fields.title']);

    $this->post(route('bibliography.store'), [
        'entry_type' => 'book',
        'fields' => ['author' => 'Page, D. L.'],
    ])->assertInvalid(['fields.title']);

    $this->post(route('bibliography.store'), [
        'entry_type' => 'phdthesis',
        'fields' => ['title' => 'A thesis'],
    ])->assertInvalid(['entry_type']);

    expect(BibliographyItem::count())->toBe(0);
});

test('an editor updates an item; the label follows the fields and the key stays unique', function () {
    $this->actingAs(User::factory()->editor()->create());
    $other = BibliographyItem::factory()->create(['citation_key' => 'taken']);
    $item = BibliographyItem::factory()->create();

    $this->patch(route('bibliography.update', $item), [
        'entry_type' => 'book',
        'citation_key' => 'taken',
        'fields' => ['author' => 'Dover, Kenneth', 'title' => 'Aristophanic Comedy', 'date' => '1972'],
    ])->assertInvalid(['citation_key']);

    $this->patch(route('bibliography.update', $item), [
        'entry_type' => 'book',
        'citation_key' => 'dover1972',
        'fields' => ['author' => 'Dover, Kenneth', 'title' => 'Aristophanic Comedy', 'date' => '1972'],
    ])->assertRedirect();

    $item->refresh();
    expect($item->citation_key)->toBe('dover1972')
        ->and($item->label)->toBe('Dover 1972')
        ->and($other->fresh()->citation_key)->toBe('taken');
});

test('an item nothing cites can be deleted; a cited one is refused and says by what', function () {
    $this->actingAs(User::factory()->editor()->create());
    $free = BibliographyItem::factory()->create();
    $cited = BibliographyItem::factory()->create();
    BibliographyReference::factory()->for($cited, 'item')->create();

    $this->delete(route('bibliography.destroy', $free))->assertRedirect();
    $this->delete(route('bibliography.destroy', $cited))->assertInvalid(['item']);

    expect(BibliographyItem::find($free->id))->toBeNull()
        ->and(BibliographyItem::find($cited->id))->not->toBeNull();
});

test('the list exports as a .bib file', function () {
    BibliographyItem::factory()->create([
        'entry_type' => 'article',
        'citation_key' => 'dover1987',
        'fields' => ['author' => 'Dover, K. J.', 'title' => 'Aristophanes', 'journaltitle' => 'CQ', 'date' => '1987'],
    ]);

    $response = $this->get(route('bibliography.export'));

    $response->assertOk()
        ->assertHeader('Content-Disposition', 'attachment; filename="bibliography.bib"');
    expect($response->getContent())->toContain("@article{dover1987,\n  author = {Dover, K. J.},");
});

test('the search box finds items by key, label, author or title', function () {
    BibliographyItem::factory()->create(['citation_key' => 'dover1987', 'label' => 'Dover 1987', 'fields' => ['author' => 'Dover, K. J.', 'title' => 'Aristophanic Comedy']]);
    BibliographyItem::factory()->create(['citation_key' => 'page1962', 'label' => 'Page 1962', 'fields' => ['editor' => 'Page, D. L.', 'title' => 'Poetae Melici Graeci']]);

    $this->get(route('bibliography.index', ['q' => 'melici']))
        ->assertInertia(fn (AssertInertia $page) => $page->has('items', 1)->where('items.0.label', 'Page 1962'));
});

test('a guest cannot change the bibliography', function () {
    $this->actingAs(User::factory()->create());
    $item = BibliographyItem::factory()->create();

    $this->post(route('bibliography.store'), ['entry_type' => 'book', 'fields' => ['title' => 'X']])->assertForbidden();
    $this->patch(route('bibliography.update', $item), ['entry_type' => 'book', 'fields' => ['title' => 'X']])->assertForbidden();
    $this->delete(route('bibliography.destroy', $item))->assertForbidden();
});

test('the page offers the names, presses, journals, places and series already recorded', function () {
    BibliographyItem::factory()->create(['fields' => [
        'author' => 'Dover, K. J. and Henderson, Jeffrey',
        'title' => 'One',
        'publisher' => 'Clarendon Press and Oxford University Press',
        'location' => 'Oxford',
        'series' => 'Oxford Classical Texts',
    ]]);
    BibliographyItem::factory()->article()->create(['fields' => [
        'editor' => 'Henderson, Jeffrey',
        'title' => 'Two',
        'journaltitle' => 'Classical Quarterly',
    ]]);

    $this->get(route('bibliography.index'))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->where('suggestions.names', [
                ['family' => 'Dover', 'given' => 'K. J.'],
                ['family' => 'Henderson', 'given' => 'Jeffrey'],
            ])
            ->where('suggestions.publisher', ['Clarendon Press', 'Oxford University Press'])
            ->where('suggestions.journaltitle', ['Classical Quarterly'])
            ->where('suggestions.location', ['Oxford'])
            ->where('suggestions.series', ['Oxford Classical Texts']));
});

test('a .bib file imports as items, skipping keys already in the list unless replacing', function () {
    $this->actingAs(User::factory()->editor()->create());
    $existing = BibliographyItem::factory()->create(['citation_key' => 'dover1972', 'fields' => ['author' => 'Dover, K. J.', 'title' => 'Old title', 'date' => '1972']]);

    $bib = "@book{dover1972,\n  author = {Dover, K. J.},\n  title = {Aristophanic Comedy},\n  date = {1972}\n}\n@article{page1962,\n  editor = {Page, D. L.},\n  title = {Poetae Melici Graeci},\n  journal = {CQ},\n  year = 1962\n}";

    $this->post(route('bibliography.import'), ['bibtex' => $bib])
        ->assertRedirect()
        ->assertSessionHas('message', 'Imported 1 item, skipped 1 already in the list (dover1972).');

    expect(BibliographyItem::count())->toBe(2)
        ->and($existing->fresh()->fields['title'])->toBe('Old title')
        ->and(BibliographyItem::where('citation_key', 'page1962')->sole()->fields['journaltitle'])->toBe('CQ');

    $this->post(route('bibliography.import'), ['bibtex' => $bib, 'replace' => true])
        ->assertRedirect()
        ->assertSessionHas('message', 'Imported 0 items, replaced 2.');

    expect(BibliographyItem::count())->toBe(2)
        ->and($existing->fresh()->fields['title'])->toBe('Aristophanic Comedy')
        ->and($existing->fresh()->label)->toBe('Dover 1972');
});

test('an import needs pasted text or a file', function () {
    $this->actingAs(User::factory()->editor()->create());

    $this->post(route('bibliography.import'), [])->assertInvalid(['bibtex']);
});

test('an edition exports only the items it cites', function () {
    $this->actingAs(User::factory()->editor()->create());
    $cited = BibliographyItem::factory()->create(['citation_key' => 'cited1900']);
    BibliographyItem::factory()->create(['citation_key' => 'uncited1900']);
    $edition = Edition::factory()->create();
    $passage = CanonicalPassage::factory()->for($edition->work)->create();
    EditionPassage::factory()->create(['edition_id' => $edition->id, 'canonical_passage_id' => $passage->id, 'transcription_layer_id' => TranscriptionLayer::factory()->create()->id]);
    BibliographyReference::factory()->for($cited, 'item')->onPassage($edition, $passage)->create();

    $response = $this->get(route('editions.bibliography.export', $edition));

    $response->assertOk();
    expect($response->getContent())->toContain('@book{cited1900,')->not->toContain('uncited1900');
});
