<?php

use App\Models\Assignment;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;

/** Describe a segment's columns as sorted word lists, comparable across runs. */
function columnsOf(Segment $segment): array
{
    return Lemma::where('segment_id', $segment->id)
        ->orderBy('position')
        ->with('readings.transcriptionLayer')
        ->get()
        ->map(fn (Lemma $lemma) => $lemma->readings
            ->map(fn (LemmaReading $reading) => $reading->transcription_layer_id === null
                ? '(conjecture)'
                : mb_substr(
                    $reading->transcriptionLayer->text,
                    $reading->start_offset,
                    $reading->end_offset - $reading->start_offset,
                ))
            ->sort()->values()->all())
        ->values()->all();
}

/** Assign a segment from a new witness with the given siglum. */
function assignAs(Segment $segment, string $siglum, string $text): Assignment
{
    $transcription = TranscriptionLayer::factory()
        ->for(Witness::factory()->create(['siglum' => $siglum]))
        ->create(['text' => $text]);

    return Assignment::factory()->for($transcription)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);
}

/**
 * Collate a segment by assigning every witness up front, then adding them to an
 * edition in `$addOrder`. Only the add order varies between runs.
 *
 * @param  array<string, string>  $texts  siglum => text
 * @param  list<string>  $addOrder
 */
function columnsAddedInOrder(array $texts, array $addOrder): array
{
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $assignments = [];

    foreach ($texts as $siglum => $text) {
        $assignments[$siglum] = assignAs($segment, $siglum, $text);
    }

    $position = 1.0;

    foreach ($addOrder as $siglum) {
        SegmentAdder::add($edition, $assignments[$siglum], $position++);
    }

    return columnsOf($segment);
}

test('the same witnesses collate identically whatever order they were added in', function () {
    $texts = [
        'A' => 'the fox sleeps',
        'B' => 'the swift creature sleeps',
        'C' => 'the creature sleeps',
    ];

    $expected = columnsAddedInOrder($texts, ['A', 'B', 'C']);

    foreach ([['A', 'C', 'B'], ['B', 'A', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A']] as $order) {
        expect(columnsAddedInOrder($texts, $order))->toBe($expected);
    }
});

test('collation does not depend on the order the transcriptions were created', function () {
    // Same sigla and wording, rows created back to front, so every
    // transcription_layer_id is reversed. Ordering by siglum keeps the result a
    // function of the evidence.
    $forward = ['A' => 'the fox sleeps', 'B' => 'the swift creature sleeps', 'C' => 'the creature sleeps'];
    $backward = array_reverse($forward, true);

    expect(columnsAddedInOrder($backward, ['A', 'B', 'C']))
        ->toBe(columnsAddedInOrder($forward, ['A', 'B', 'C']));
});

test('a witness assigned only after the segment was collated still yields the same columns', function () {
    // What ordering alone cannot fix. A sorts first and so ought to seed the
    // columns, but it is assigned after B and C have already collated between
    // themselves; appended, it would never get to.
    $texts = ['A' => 'the fox sleeps', 'B' => 'the swift creature sleeps', 'C' => 'the creature sleeps'];
    $allPresent = columnsAddedInOrder($texts, ['A', 'B', 'C']);

    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $b = assignAs($segment, 'B', $texts['B']);
    assignAs($segment, 'C', $texts['C']);
    SegmentAdder::add($edition, $b, 1.0);

    SegmentAdder::add($edition, assignAs($segment, 'A', $texts['A']), 2.0);

    expect(columnsOf($segment))->toBe($allPresent);
});

test('a placed conjecture stops the rebuild and survives a later witness', function () {
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    SegmentAdder::add($edition, assignAs($segment, 'B', 'the quick fox'), 1.0);

    $middle = Lemma::where('segment_id', $segment->id)->orderBy('position')->get()[1];
    $reading = $middle->readings()->create([
        'conjecture_id' => Conjecture::factory()->for($segment, 'segment')->create()->id,
    ]);

    // "A" sorts before "B", so without the guard this would rebuild and take
    // the conjecture's column with it.
    SegmentAdder::add($edition, assignAs($segment, 'A', 'the slow fox'), 2.0);

    expect(LemmaReading::whereKey($reading->id)->exists())->toBeTrue()
        ->and($reading->fresh()->lemma_id)->toBe($middle->id)
        ->and(LemmaReading::where('transcription_layer_id', '!=', null)->count())->toBeGreaterThan(3);
});

test("an edition's selection stops the rebuild and survives a later witness", function () {
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    SegmentAdder::add($edition, assignAs($segment, 'B', 'the quick fox'), 1.0);

    $middle = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings')->get()[1];
    $selection = EditionLemma::create([
        'edition_id' => $edition->id,
        'lemma_id' => $middle->id,
        'selected_reading_id' => $middle->readings->first()->id,
    ]);

    $later = assignAs($segment, 'A', 'the slow fox');
    SegmentAdder::add($edition, $later, 2.0);

    expect(EditionLemma::whereKey($selection->id)->exists())->toBeTrue()
        ->and($selection->fresh()->selected_reading_id)->toBe($middle->readings->first()->id)
        // The newcomer still joined the collation, by appending.
        ->and(LemmaReading::where('transcription_layer_id', $later->transcription_layer_id)->count())->toBeGreaterThan(0);
});
