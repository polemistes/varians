<?php

use App\Models\Assignment;
use App\Models\Edition;
use App\Models\EditionLineBreak;
use App\Models\EditionSegment;
use App\Models\Lemma;
use App\Models\Segment;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAligner;

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

function assignSegment(Work $work, TranscriptionLayer $layer, string $label, int $start, int $end, int $part = 1): Assignment
{
    static $line = 0;
    $segment = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => ++$line],
        'sort_key' => sprintf('00000001.%08d', $line),
        'label' => $label,
    ]);

    return Assignment::factory()->for($layer)->for($segment, 'segment')
        ->create(['start_offset' => $start, 'end_offset' => $end, 'part' => $part]);
}

test('adding segments seeds the boundary flags from the base transcription\'s spacing', function () {
    $this->actingAs(User::factory()->editor()->create());
    // "one two" share a line; "three" starts a new line; "four" a paragraph.
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("one two\nthree\n\nfour");
    assignSegment($work, $layer, '1.1', 0, 3);
    assignSegment($work, $layer, '1.2', 4, 7);
    assignSegment($work, $layer, '1.3', 8, 13);
    assignSegment($work, $layer, '1.4', 15, 19);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 19,
    ])->assertRedirect();

    $flags = EditionSegment::where('edition_id', $edition->id)
        ->orderBy('position')
        ->get()
        ->map(fn (EditionSegment $p) => [$p->starts_new_line, $p->starts_new_paragraph])
        ->all();

    expect($flags)->toBe([
        [true, false],  // first segment: fresh line by default
        [false, false], // "two" flows on
        [true, false],  // "three" after one newline
        [true, true],   // "four" after a blank line
    ]);
});

test('a span that swallows its own newline still seeds the boundary flags', function () {
    $this->actingAs(User::factory()->editor()->create());
    // Drag-selecting a full line routinely runs the span to the start of
    // the next line, so the "\n" sits INSIDE the assigned span and the gap
    // between spans is empty — real R2 data looked exactly like this, and
    // the seeder read verse as prose. The newline's side of the span
    // boundary is an accident of selection; the flags must not depend on it.
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("one two\nthree\n\nfour");
    assignSegment($work, $layer, '4.1', 0, 8);   // "one two\n" — newline swallowed
    assignSegment($work, $layer, '4.2', 8, 15);  // "three\n\n" — both newlines swallowed
    assignSegment($work, $layer, '4.3', 15, 19); // "four"

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 19,
    ])->assertRedirect();

    $flags = EditionSegment::where('edition_id', $edition->id)
        ->orderBy('position')
        ->get()
        ->map(fn (EditionSegment $p) => [$p->starts_new_line, $p->starts_new_paragraph])
        ->all();

    expect($flags)->toBe([
        [true, false],  // first segment: fresh line by default
        [true, false],  // "three" after the swallowed newline
        [true, true],   // "four" after the swallowed blank line
    ]);
});

test('newlines inside a segment seed colometry breaks before the right columns', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("one two\nthree four");
    $assignment = assignSegment($work, $layer, '2.1', 0, 18);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 18,
    ])->assertRedirect();

    $lemmas = Lemma::where('segment_id', $assignment->segment_id)
        ->orderBy('position')->get();
    $breaks = EditionLineBreak::where('edition_id', $edition->id)->get();

    expect($lemmas)->toHaveCount(4)
        ->and($breaks)->toHaveCount(1)
        ->and($breaks->first()->lemma_id)->toBe($lemmas[2]->id) // before "three"
        ->and($breaks->first()->kind)->toBe('line');
});

test('the gap across a discontinuous assignment\'s part boundary seeds nothing', function () {
    $this->actingAs(User::factory()->editor()->create());
    // Content order "the quick" then "fox", physically reversed — the jump
    // between parts is displacement, not whitespace.
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("fox\nthe quick");
    $first = assignSegment($work, $layer, '3.1', 4, 13, 1);
    Assignment::factory()->for($layer)->for($first->segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 13,
    ])->assertRedirect();

    expect(EditionLineBreak::where('edition_id', $edition->id)->count())->toBe(0);
});

test('the edition page ships lineation: segment flags and per-run break_before', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup("one two\nthree four");
    assignSegment($work, $layer, '4.1', 0, 18);

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $layer->id,
        'start_offset' => 0,
        'end_offset' => 18,
    ]);

    $segment = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowSegments'][0];

    expect($segment['starts_new_line'])->toBeTrue()
        ->and($segment['starts_new_paragraph'])->toBeFalse()
        // A run without a break leaves the field out of the wire — see
        // EditionController::slimRun.
        ->and(array_map(fn (array $run) => $run['break_before'] ?? null, $segment['runs']))->toBe([null, null, 'line', null]);
});

test('a colometry break pins the segment\'s columns against a collation rebuild', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $assignment = assignSegment($work, $layer, '5.1', 0, 13);
    $segment = $assignment->segment;

    SegmentAligner::collate($segment, collect([$assignment]));
    $lemmaIds = Lemma::where('segment_id', $segment->id)->orderBy('position')->pluck('id');

    EditionLineBreak::create([
        'edition_id' => $edition->id,
        'segment_id' => $segment->id,
        'lemma_id' => $lemmaIds[1],
        'kind' => 'line',
    ]);

    // A rebuild would cascade the break away with its column — so the
    // columns must be appended to, never rebuilt, while a break stands.
    SegmentAligner::collate($segment, collect([$assignment]));

    expect(Lemma::where('segment_id', $segment->id)->orderBy('position')->pluck('id')->all())
        ->toBe($lemmaIds->all())
        ->and(EditionLineBreak::whereKey($lemmaIds[1])->exists() || EditionLineBreak::where('lemma_id', $lemmaIds[1])->exists())->toBeTrue();
});

test('realignLayer declines while a break sits on a column only that layer fills', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $assignment = assignSegment($work, $layer, '6.1', 0, 13);
    $segment = $assignment->segment;

    SegmentAligner::alignWitness($segment, collect([$assignment]));
    $lemma = Lemma::where('segment_id', $segment->id)->orderBy('position')->first();

    EditionLineBreak::create([
        'edition_id' => $edition->id,
        'segment_id' => $segment->id,
        'lemma_id' => $lemma->id,
        'kind' => 'line',
    ]);

    expect(SegmentAligner::realignLayer($segment, $layer))->toBeFalse()
        ->and(Lemma::whereKey($lemma->id)->exists())->toBeTrue();
});

test('the break endpoint cycles: set, change kind, clear', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $assignment = assignSegment($work, $layer, '7.1', 0, 13);
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $layer->id, 'start_offset' => 0, 'end_offset' => 13,
    ]);
    $lemma = Lemma::where('segment_id', $assignment->segment_id)->orderBy('position')->get()[1];

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => 'line'])->assertRedirect();
    expect(EditionLineBreak::where('edition_id', $edition->id)->sole()->kind)->toBe('line');

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => 'paragraph'])->assertRedirect();
    expect(EditionLineBreak::where('edition_id', $edition->id)->sole()->kind)->toBe('paragraph');

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => null])->assertRedirect();
    expect(EditionLineBreak::where('edition_id', $edition->id)->count())->toBe(0);
});

test('a break cannot be placed on a column of a segment the edition does not contain', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    $assignment = assignSegment($work, $layer, '8.1', 0, 13);
    SegmentAligner::collate($assignment->segment, collect([$assignment]));
    $lemma = Lemma::where('segment_id', $assignment->segment_id)->first();

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => $lemma->id, 'kind' => 'line'])
        ->assertInvalid(['lemma_id']);
});

test('the segment-boundary flags update through their endpoint', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'layer' => $layer] = lineationSetup('the quick fox');
    assignSegment($work, $layer, '9.1', 0, 13);
    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $layer->id, 'start_offset' => 0, 'end_offset' => 13,
    ]);
    $editionSegment = EditionSegment::where('edition_id', $edition->id)->sole();

    $this->patch(route('edition-segments.lineation.update', $editionSegment), [
        'starts_new_line' => false,
        'starts_new_paragraph' => false,
    ])->assertRedirect();

    $editionSegment->refresh();
    expect($editionSegment->starts_new_line)->toBeFalse()
        ->and($editionSegment->starts_new_paragraph)->toBeFalse();
});

test('a guest cannot touch lineation', function () {
    $this->actingAs(User::factory()->create());
    ['work' => $work, 'edition' => $edition] = lineationSetup('the quick fox');

    $this->patch(route('edition-line-breaks.update', $edition), ['lemma_id' => 1, 'kind' => 'line'])
        ->assertForbidden();
});
