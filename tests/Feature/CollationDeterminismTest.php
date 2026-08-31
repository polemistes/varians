<?php

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;

/** Describe a passage's columns as sorted word lists, comparable across runs. */
function columnsOf(CanonicalPassage $passage): array
{
    return Lemma::where('canonical_passage_id', $passage->id)
        ->orderBy('position')
        ->with('readings.transcription')
        ->get()
        ->map(fn (Lemma $lemma) => $lemma->readings
            ->map(fn (LemmaReading $reading) => $reading->transcription_id === null
                ? '(conjecture)'
                : mb_substr(
                    $reading->transcription->text,
                    $reading->start_offset,
                    $reading->end_offset - $reading->start_offset,
                ))
            ->sort()->values()->all())
        ->values()->all();
}

/** Cite a passage from a new witness with the given siglum. */
function citeAs(CanonicalPassage $passage, string $siglum, string $text): TranscriptionSegment
{
    $transcription = Transcription::factory()
        ->for(Witness::factory()->create(['siglum' => $siglum]))
        ->create(['text' => $text]);

    return TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);
}

/**
 * Collate a passage by citing every witness up front, then adding them to an
 * edition in `$addOrder`. Only the add order varies between runs.
 *
 * @param  array<string, string>  $texts  siglum => text
 * @param  list<string>  $addOrder
 */
function columnsAddedInOrder(array $texts, array $addOrder): array
{
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $segments = [];

    foreach ($texts as $siglum => $text) {
        $segments[$siglum] = citeAs($passage, $siglum, $text);
    }

    $position = 1.0;

    foreach ($addOrder as $siglum) {
        PassageAdder::add($edition, $segments[$siglum], $position++);
    }

    return columnsOf($passage);
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
    // transcription_id is reversed. Ordering by siglum keeps the result a
    // function of the evidence.
    $forward = ['A' => 'the fox sleeps', 'B' => 'the swift creature sleeps', 'C' => 'the creature sleeps'];
    $backward = array_reverse($forward, true);

    expect(columnsAddedInOrder($backward, ['A', 'B', 'C']))
        ->toBe(columnsAddedInOrder($forward, ['A', 'B', 'C']));
});

test('a witness cited only after the passage was collated still yields the same columns', function () {
    // What ordering alone cannot fix. A sorts first and so ought to seed the
    // columns, but it is cited after B and C have already collated between
    // themselves; appended, it would never get to.
    $texts = ['A' => 'the fox sleeps', 'B' => 'the swift creature sleeps', 'C' => 'the creature sleeps'];
    $allPresent = columnsAddedInOrder($texts, ['A', 'B', 'C']);

    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $b = citeAs($passage, 'B', $texts['B']);
    citeAs($passage, 'C', $texts['C']);
    PassageAdder::add($edition, $b, 1.0);

    PassageAdder::add($edition, citeAs($passage, 'A', $texts['A']), 2.0);

    expect(columnsOf($passage))->toBe($allPresent);
});

test('a placed conjecture stops the rebuild and survives a later witness', function () {
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    PassageAdder::add($edition, citeAs($passage, 'B', 'the quick fox'), 1.0);

    $middle = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[1];
    $reading = $middle->readings()->create([
        'conjecture_id' => Conjecture::factory()->for($passage, 'canonicalPassage')->create()->id,
    ]);

    // "A" sorts before "B", so without the guard this would rebuild and take
    // the conjecture's column with it.
    PassageAdder::add($edition, citeAs($passage, 'A', 'the slow fox'), 2.0);

    expect(LemmaReading::whereKey($reading->id)->exists())->toBeTrue()
        ->and($reading->fresh()->lemma_id)->toBe($middle->id)
        ->and(LemmaReading::where('transcription_id', '!=', null)->count())->toBeGreaterThan(3);
});

test("an edition's selection stops the rebuild and survives a later witness", function () {
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    PassageAdder::add($edition, citeAs($passage, 'B', 'the quick fox'), 1.0);

    $middle = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings')->get()[1];
    $selection = EditionLemma::create([
        'edition_id' => $edition->id,
        'lemma_id' => $middle->id,
        'selected_reading_id' => $middle->readings->first()->id,
    ]);

    $later = citeAs($passage, 'A', 'the slow fox');
    PassageAdder::add($edition, $later, 2.0);

    expect(EditionLemma::whereKey($selection->id)->exists())->toBeTrue()
        ->and($selection->fresh()->selected_reading_id)->toBe($middle->readings->first()->id)
        // The newcomer still joined the collation, by appending.
        ->and(LemmaReading::where('transcription_id', $later->transcription_id)->count())->toBeGreaterThan(0);
});
