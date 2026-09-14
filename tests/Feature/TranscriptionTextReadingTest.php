<?php

use App\Models\Assignment;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;
use App\Support\Edition\SegmentAligner;

/**
 * Collate one transcription into a segment and return its readings keyed by
 * the word each was taken from.
 */
function collatedReadings(TranscriptionLayer $transcription, string $text): array
{
    $segment = Segment::factory()->create();
    $assignment = Assignment::factory()->for($transcription)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);

    SegmentAligner::alignWitness($segment, collect([$assignment]));

    return Lemma::where('segment_id', $segment->id)->orderBy('position')
        ->with('readings')->get()
        ->mapWithKeys(fn (Lemma $lemma) => [
            mb_substr($text, $lemma->readings->first()->start_offset, $lemma->readings->first()->end_offset - $lemma->readings->first()->start_offset) => $lemma->readings->first(),
        ])->all();
}

/** The word a reading currently resolves to against the live text. */
function readingText(LemmaReading $reading): string
{
    $reading->refresh();
    $text = $reading->transcriptionLayer->fresh()->text;

    return mb_substr($text, $reading->start_offset, $reading->end_offset - $reading->start_offset);
}

test('editing a word re-derives the reading collated from it', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');
    $segmentId = $readings['quick']->lemma->segment_id;

    // Replace "quick" (4-9) with "slow" — the exact case that used to leave
    // the apparatus reading "the" / "slow " / "ox". Nothing selects these
    // readings, so the damaged one is re-derived by re-collation.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 9, 'text' => 'slow']],
        'text' => 'the slow fox',
    ])->assertRedirect();

    $words = LemmaReading::whereIn(
        'lemma_id',
        Lemma::where('segment_id', $segmentId)->pluck('id'),
    )->where('transcription_layer_id', $transcription->id)->get()
        ->map(fn (LemmaReading $reading) => mb_substr(
            $transcription->fresh()->text,
            $reading->start_offset,
            $reading->end_offset - $reading->start_offset,
        ))->sort()->values()->all();

    expect($words)->toBe(['fox', 'slow', 'the']);
});

test('an insertion before a reading shifts it rather than corrupting it', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the fox']);
    $readings = collatedReadings($transcription, 'the fox');

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => 'swift ']],
        'text' => 'the swift fox',
    ])->assertRedirect();

    expect(readingText($readings['fox']))->toBe('fox')
        ->and($readings['fox']->fresh()->needs_review)->toBeFalse();
});

test('an edit partially clobbering unselected readings re-derives them instead of flagging', function () {
    // User decision, narrowing needs_review to selected readings: a
    // reading nothing selects is machine-re-derivable, so damage is
    // answered by deletion + re-collation, never by flagging a human.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->normalized()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');
    $segmentId = $readings['quick']->lemma->segment_id;

    // Replace "ick f" — straddles the "quick" and "fox" readings.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 6, 'end' => 11, 'text' => 'X']],
        'text' => 'the quXox',
    ])->assertRedirect();

    // The damaged rows are gone; the segment was re-collated against the
    // new text, so the apparatus reads real words again, unflagged.
    expect(LemmaReading::whereKey($readings['quick']->id)->exists())->toBeFalse()
        ->and(LemmaReading::whereKey($readings['fox']->id)->exists())->toBeFalse();

    $rederived = LemmaReading::whereIn(
        'lemma_id',
        Lemma::where('segment_id', $segmentId)->pluck('id'),
    )->where('transcription_layer_id', $transcription->id)->get();

    $words = $rederived->map(fn (LemmaReading $reading) => mb_substr(
        $transcription->fresh()->text,
        $reading->start_offset,
        $reading->end_offset - $reading->start_offset,
    ))->sort()->values()->all();

    expect($words)->toBe(['quXox', 'the'])
        ->and($rederived->every(fn (LemmaReading $reading) => ! $reading->needs_review))->toBeTrue();
});

test('an edit partially clobbering a SELECTED reading flags it for the editor', function () {
    // The one irreplaceable case: an edition's choice whose manuscript
    // backing changed — the machine must not re-derive over a decision.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->normalized()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    EditionLemma::create([
        'edition_id' => Edition::factory()->create()->id,
        'lemma_id' => $readings['quick']->lemma_id,
        'selected_reading_id' => $readings['quick']->id,
    ]);

    // Straddle "quick"'s right boundary — the transform can only guess.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 6, 'end' => 11, 'text' => 'X']],
        'text' => 'the quXox',
    ])->assertRedirect();

    // The selected reading is kept and flagged; the unselected 'fox' was
    // damaged too and deleted, but re-derivation is refused while a pinned
    // (selected) reading holds the segment — the flag on the selection is
    // now the segment's one open question.
    expect($readings['quick']->fresh()->needs_review)->toBeTrue()
        ->and(LemmaReading::whereKey($readings['fox']->id)->exists())->toBeFalse();
});

test('a destroyed reading nothing selected is removed and the rest re-derived, with no prompt', function () {
    // The case that motivated dropping the prompt: no edition prints this
    // witness here, so there is nothing to decide and nothing to report.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');
    $segmentId = $readings['quick']->lemma->segment_id;

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 3, 'end' => 9, 'text' => '']],
        'text' => 'the fox',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $words = LemmaReading::whereIn(
        'lemma_id',
        Lemma::where('segment_id', $segmentId)->pluck('id'),
    )->where('transcription_layer_id', $transcription->id)->get()
        ->map(fn (LemmaReading $reading) => mb_substr(
            $transcription->fresh()->text,
            $reading->start_offset,
            $reading->end_offset - $reading->start_offset,
        ))->sort()->values()->all();

    expect($transcription->fresh()->text)->toBe('the fox')
        ->and(LemmaReading::whereKey($readings['quick']->id)->exists())->toBeFalse()
        ->and($words)->toBe(['fox', 'the'])
        ->and(session('message'))->toBeNull();
});

test('a destroyed reading an edition selected is kept, collapsed and flagged', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    $selection = EditionLemma::create([
        'edition_id' => Edition::factory()->create()->id,
        'lemma_id' => $readings['quick']->lemma_id,
        'selected_reading_id' => $readings['quick']->id,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 3, 'end' => 9, 'text' => '']],
        'text' => 'the fox',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $lost = $readings['quick']->fresh();

    expect($lost)->not->toBeNull()
        ->and($lost->needs_review)->toBeTrue()
        ->and($lost->start_offset)->toBe($lost->end_offset) // collapsed at the edit point
        ->and(EditionLemma::whereKey($selection->id)->exists())->toBeTrue();
});

test('editing the words an edition prints reports that edition by title', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    EditionLemma::create([
        'edition_id' => Edition::factory()->create(['title' => 'Iliad, a new edition'])->id,
        'lemma_id' => $readings['quick']->lemma_id,
        'selected_reading_id' => $readings['quick']->id,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 9, 'text' => 'slow']],
        'text' => 'the slow fox',
    ])->assertRedirect();

    expect(session('message'))->toContain('Iliad, a new edition')
        ->and(readingText($readings['quick']))->toBe('slow');
});

test('editing a witness the edition does not print reports nothing', function () {
    $this->actingAs(User::factory()->editor()->create());
    $printed = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $other = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);

    $segment = Segment::factory()->create();
    foreach ([$printed, $other] as $t) {
        SegmentAligner::alignWitness($segment, collect([Assignment::factory()->for($t)
            ->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13])]));
    }

    $middle = Lemma::where('segment_id', $segment->id)->orderBy('position')->get()[1];
    EditionLemma::create([
        'edition_id' => Edition::factory()->create(['title' => 'Iliad, a new edition'])->id,
        'lemma_id' => $middle->id,
        'selected_reading_id' => $middle->readings->firstWhere('transcription_layer_id', $printed->id)->id,
    ]);

    // Edit the OTHER witness. The edition still prints $printed, so a reader
    // sees no change — only the apparatus reports the new wording.
    $this->patch(route('transcriptions.text.update', $other), [
        'ops' => [['start' => 4, 'end' => 9, 'text' => 'slow']],
        'text' => 'the slow fox',
    ])->assertRedirect();

    expect(session('message'))->toBeNull();
});

test('an edit that only shifts a selected reading reports nothing', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    EditionLemma::create([
        'edition_id' => Edition::factory()->create(['title' => 'Iliad, a new edition'])->id,
        'lemma_id' => $readings['fox']->lemma_id,
        'selected_reading_id' => $readings['fox']->id,
    ]);

    // Insert before "fox" — its offsets move, its words do not.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => 'very ']],
        'text' => 'the very quick fox',
    ])->assertRedirect();

    expect(session('message'))->toBeNull()
        ->and(readingText($readings['fox']))->toBe('fox');
});

test('a conjecture reading has no offsets and is never touched by a text edit', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    $conjecture = LemmaReading::factory()->create([
        'lemma_id' => $readings['quick']->lemma_id,
        'transcription_layer_id' => null,
        'start_offset' => null,
        'end_offset' => null,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 13, 'text' => 'wholly new text']],
        'text' => 'wholly new text',
    ])->assertRedirect();

    $conjecture->refresh();

    expect($conjecture->start_offset)->toBeNull()
        ->and($conjecture->end_offset)->toBeNull()
        ->and($conjecture->needs_review)->toBeFalse();
});

/**
 * Two witnesses collated on one segment, an edition printing the first.
 *
 * @return array{segment: Segment, edition: Edition, a: TranscriptionLayer, b: TranscriptionLayer}
 */
function collatedPair(string $aText, string $bText): array
{
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $a = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => $aText]);
    $b = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => $bText]);
    $assignment = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($bText)]);
    $edition = Edition::factory()->for($work)->create(['title' => 'The edition']);
    SegmentAdder::add($edition, $assignment, 1.0);

    return compact('segment', 'edition', 'a', 'b');
}

/** What the edition prints for its one segment, and each column's readings as "siglum:word". */
function printedAndColumns(Edition $edition, Segment $segment): array
{
    $runs = test()->get(route('editions.show', [$edition->work, $edition]))
        ->viewData('page')['props']['windowSegments'][0]['runs'];
    $columns = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings.transcriptionLayer.witness')->get()
        ->map(fn (Lemma $lemma) => $lemma->readings->sortBy(fn (LemmaReading $r) => $r->transcriptionLayer->witness->siglum)
            ->map(fn (LemmaReading $r) => $r->transcriptionLayer->witness->siglum.':'.($r->omitted ? '—' : readingText($r)))
            ->values()->all())
        ->all();

    return [implode(' ', array_column($runs, 'text')), $columns];
}

test('a word typed into a collated witness enters the collation and the edition that prints it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'a' => $a] = collatedPair('the quick fox', 'the quick fox');

    // Nothing selected: the layer is simply re-collated, and B now omits
    // the word A gained.
    $this->patch(route('transcriptions.text.update', $a), [
        'ops' => [['start' => 10, 'end' => 10, 'text' => 'brown ']],
        'text' => 'the quick brown fox',
    ])->assertRedirect()->assertSessionHas('message', fn (string $message) => str_contains($message, 'The edition'));

    [$printed, $columns] = printedAndColumns($edition, $segment);

    expect($printed)->toBe('the quick brown fox')
        ->and($columns)->toBe([['A:the', 'B:the'], ['A:quick', 'B:quick'], ['A:brown', 'B:—'], ['A:fox', 'B:fox']]);
});

test('a word typed into a witness an edition has chosen from grows the collation around the choice', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'a' => $a, 'b' => $b] = collatedPair('the quick fox', 'the quick dog');

    // The edition adopts B's "dog": A's readings are pinned, so the layer
    // cannot be rebuilt — the new word gets a column of its own between
    // its neighbours, and the choice survives untouched.
    $last = Lemma::where('segment_id', $segment->id)->orderBy('position')->get()->last();
    $dog = LemmaReading::where('lemma_id', $last->id)->where('transcription_layer_id', $b->id)->sole();
    EditionLemma::create(['edition_id' => $edition->id, 'lemma_id' => $last->id, 'selected_reading_id' => $dog->id]);
    $before = SegmentAligner::layerReadings($segment, $a)->pluck('id')->sort()->values()->all();

    $this->patch(route('transcriptions.text.update', $a), [
        'ops' => [['start' => 10, 'end' => 10, 'text' => 'brown ']],
        'text' => 'the quick brown fox',
    ])->assertRedirect();

    [$printed, $columns] = printedAndColumns($edition, $segment);
    $after = SegmentAligner::layerReadings($segment, $a)->where('omitted', false)->pluck('id')->sort()->values()->all();

    expect($printed)->toBe('the quick brown dog')
        ->and($columns)->toBe([['A:the', 'B:the'], ['A:quick', 'B:quick'], ['A:brown', 'B:—'], ['A:fox', 'B:dog']])
        ->and(array_intersect($before, $after))->toHaveCount(3)
        ->and(EditionLemma::where('edition_id', $edition->id)->sole()->selected_reading_id)->toBe($dog->id);
});

test('a word typed in that another witness already has takes that witness\'s column', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'a' => $a, 'b' => $b] = collatedPair('the fox', 'the quick fox');

    // Pinned by a choice elsewhere on the line, so the collation grows
    // rather than rebuilds — and A's new "quick" is B's column, where A
    // used to omit.
    $first = Lemma::where('segment_id', $segment->id)->orderBy('position')->first();
    $the = LemmaReading::where('lemma_id', $first->id)->where('transcription_layer_id', $a->id)->sole();
    EditionLemma::create(['edition_id' => $edition->id, 'lemma_id' => $first->id, 'selected_reading_id' => $the->id]);

    $this->patch(route('transcriptions.text.update', $a), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => 'quick ']],
        'text' => 'the quick fox',
    ])->assertRedirect();

    [$printed, $columns] = printedAndColumns($edition, $segment);

    expect($printed)->toBe('the quick fox')
        ->and($columns)->toBe([['A:the', 'B:the'], ['A:quick', 'B:quick'], ['A:fox', 'B:fox']]);
});

test('a word a reading grew into widens the reading instead of doubling it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['segment' => $segment, 'edition' => $edition, 'a' => $a, 'b' => $b] = collatedPair('the quick fox', 'the quick dog');

    $last = Lemma::where('segment_id', $segment->id)->orderBy('position')->get()->last();
    $dog = LemmaReading::where('lemma_id', $last->id)->where('transcription_layer_id', $b->id)->sole();
    EditionLemma::create(['edition_id' => $edition->id, 'lemma_id' => $last->id, 'selected_reading_id' => $dog->id]);

    // "quick" -> "quickly" by typing at the word's end.
    $this->patch(route('transcriptions.text.update', $a), [
        'ops' => [['start' => 9, 'end' => 9, 'text' => 'ly']],
        'text' => 'the quickly fox',
    ])->assertRedirect();

    [, $columns] = printedAndColumns($edition, $segment);

    expect($columns)->toBe([['A:the', 'B:the'], ['A:quickly', 'B:quick'], ['A:fox', 'B:dog']]);
});

test('an edit to a witness never collated on the segment collates nothing', function () {
    $this->actingAs(User::factory()->editor()->create());
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $segment = Segment::factory()->create();
    Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13]);

    $this->patch(route('transcriptions.text.update', $a), [
        'ops' => [['start' => 10, 'end' => 10, 'text' => 'brown ']],
        'text' => 'the quick brown fox',
    ])->assertRedirect();

    expect(Lemma::where('segment_id', $segment->id)->count())->toBe(0);
});
