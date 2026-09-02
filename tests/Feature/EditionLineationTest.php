<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLineBreak;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAligner;

/**
 * @return array{work: Work, edition: Edition, layer: TranscriptionLayer}
 */
function lineationSetup(string $text, string $siglum = 'A'): array
{
    $work = Work::factory()->create();
    $edition = Edition::factory()->for($work)->create();
    $transcription = Transcription::factory()
        ->for(Witness::factory()->create(['siglum' => $siglum]))
        ->create(['visibility' => 'published']);
    $layer = TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => $text]);

    return ['work' => $work, 'edition' => $edition, 'layer' => $layer];
}

function citePassage(Work $work, TranscriptionLayer $layer, string $label, int $start, int $end, int $part = 1): TranscriptionSegment
{
    static $line = 0;
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => ++$line],
        'sort_key' => sprintf('00000001.%08d', $line),
        'label' => $label,
    ]);

    return TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => $start, 'end_offset' => $end, 'part' => $part]);
}

test('adding passages seeds the boundary flags from the base transcription\'s spacing', function () {
    $this->actingAs(User::factory()->editor()->create());
    // "one two" share a line; "three" starts a new line; "four" a paragraph.
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("one two\nthree\n\nfour");
    citePassage($work, $layer, '1.1', 0, 3);
    citePassage($work, $layer, '1.2', 4, 7);
    citePassage($work, $layer, '1.3', 8, 13);
    citePassage($work, $layer, '1.4', 15, 19);

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 19,
    ])->assertRedirect();

    $flags = EditionPassage::where('edition_id', $edition->id)
        ->orderBy('position')
        ->get()
        ->map(fn (EditionPassage $p) => [$p->starts_new_line, $p->starts_new_paragraph])
        ->all();

    expect($flags)->toBe([
        [true, false],  // first passage: fresh line by default
        [false, false], // "two" flows on
        [true, false],  // "three" after one newline
        [true, true],   // "four" after a blank line
    ]);
});

test('newlines inside a passage seed colometry breaks before the right columns', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("one two\nthree four");
    $segment = citePassage($work, $layer, '2.1', 0, 18);

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 18,
    ])->assertRedirect();

    $lemmas = Lemma::where('canonical_passage_id', $segment->canonical_passage_id)
        ->orderBy('position')->get();
    $breaks = EditionLineBreak::where('edition_id', $edition->id)->get();

    expect($lemmas)->toHaveCount(4)
        ->and($breaks)->toHaveCount(1)
        ->and($breaks->first()->lemma_id)->toBe($lemmas[2]->id) // before "three"
        ->and($breaks->first()->kind)->toBe('line');
});

test('the gap across a discontinuous citation\'s part boundary seeds nothing', function () {
    $this->actingAs(User::factory()->editor()->create());
    // Content order "the quick" then "fox", physically reversed — the jump
    // between parts is displacement, not whitespace.
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("fox\nthe quick");
    $first = citePassage($work, $layer, '3.1', 4, 13, 1);
    TranscriptionSegment::factory()->for($layer)->for($first->canonicalPassage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]);

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 13,
    ])->assertRedirect();

    expect(EditionLineBreak::where('edition_id', $edition->id)->count())->toBe(0);
});

test('the edition page ships lineation: passage flags and per-run break_before', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("one two\nthree four");
    citePassage($work, $layer, '4.1', 0, 18);

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 18,
    ]);

    $passage = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'][0];

    expect($passage['starts_new_line'])->toBeTrue()
        ->and($passage['starts_new_paragraph'])->toBeFalse()
        ->and(array_column($passage['runs'], 'break_before'))->toBe([null, null, 'line', null]);
});

test('a colometry break pins the passage\'s columns against a collation rebuild', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $segment = citePassage($work, $layer, '5.1', 0, 13);
    $passage = $segment->canonicalPassage;

    PassageAligner::collate($passage, collect([$segment]));
    $lemmaIds = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->pluck('id');

    EditionLineBreak::create([
        'edition_id' => $edition->id,
        'canonical_passage_id' => $passage->id,
        'lemma_id' => $lemmaIds[1],
        'kind' => 'line',
    ]);

    // A rebuild would cascade the break away with its column — so the
    // columns must be appended to, never rebuilt, while a break stands.
    PassageAligner::collate($passage, collect([$segment]));

    expect(Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->pluck('id')->all())
        ->toBe($lemmaIds->all())
        ->and(EditionLineBreak::whereKey($lemmaIds[1])->exists() || EditionLineBreak::where('lemma_id', $lemmaIds[1])->exists())->toBeTrue();
});

test('realignLayer declines while a break sits on a column only that layer fills', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $segment = citePassage($work, $layer, '6.1', 0, 13);
    $passage = $segment->canonicalPassage;

    PassageAligner::alignWitness($passage, collect([$segment]));
    $lemma = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->first();

    EditionLineBreak::create([
        'edition_id' => $edition->id,
        'canonical_passage_id' => $passage->id,
        'lemma_id' => $lemma->id,
        'kind' => 'line',
    ]);

    expect(PassageAligner::realignLayer($passage, $layer))->toBeFalse()
        ->and(Lemma::whereKey($lemma->id)->exists())->toBeTrue();
});

test('the break endpoint cycles: set, change kind, clear', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $segment = citePassage($work, $layer, '7.1', 0, 13);
    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $layer->id, 'start_offset' => 0, 'end_offset' => 13,
    ]);
    $lemma = Lemma::where('canonical_passage_id', $segment->canonical_passage_id)->orderBy('position')->get()[1];

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => 'line'])->assertRedirect();
    expect(EditionLineBreak::where('edition_id', $edition->id)->sole()->kind)->toBe('line');

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => 'paragraph'])->assertRedirect();
    expect(EditionLineBreak::where('edition_id', $edition->id)->sole()->kind)->toBe('paragraph');

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => null])->assertRedirect();
    expect(EditionLineBreak::where('edition_id', $edition->id)->count())->toBe(0);
});

test('a break cannot be placed on a column of a passage the edition does not contain', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $segment = citePassage($work, $layer, '8.1', 0, 13);
    PassageAligner::collate($segment->canonicalPassage, collect([$segment]));
    $lemma = Lemma::where('canonical_passage_id', $segment->canonical_passage_id)->first();

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => 'line'])
        ->assertInvalid(['lemma_id']);
});

test('the passage-boundary flags update through their endpoint', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    citePassage($work, $layer, '9.1', 0, 13);
    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $layer->id, 'start_offset' => 0, 'end_offset' => 13,
    ]);
    $editionPassage = EditionPassage::where('edition_id', $edition->id)->sole();

    $this->patch(route('edition-passages.lineation.update', $editionPassage), [
        'starts_new_line' => false,
        'starts_new_paragraph' => false,
    ])->assertRedirect();

    $editionPassage->refresh();
    expect($editionPassage->starts_new_line)->toBeFalse()
        ->and($editionPassage->starts_new_paragraph)->toBeFalse();
});

test('a guest cannot touch lineation', function () {
    $this->actingAs(User::factory()->create());
    ['work' => $work, 'edition' => $edition] = lineationSetup('the quick fox');

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => 1, 'kind' => 'line'])
        ->assertForbidden();
});
