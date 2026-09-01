<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Two witnesses on one passage, the first added seeding the columns; returns
 * the wording each edition prints.
 *
 * @return array{first: string, second: string}
 */
function printedByEachEdition(string $seedText, string $otherText): array
{
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);

    // Sigla pinned so the seed witness is deterministic — witnesses align in
    // siglum order, and these tests turn on which one built the columns.
    $seed = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => $seedText]);
    $other = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => $otherText]);
    $seedSegment = TranscriptionSegment::factory()->for($seed)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($seedText)]);
    $otherSegment = TranscriptionSegment::factory()->for($other)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($otherText)]);

    $first = Edition::factory()->for($work)->create(['title' => 'First edition']);
    PassageAdder::add($first, $seedSegment, 1.0);

    $second = Edition::factory()->for($work)->create(['title' => 'Second edition']);
    PassageAdder::add($second, $otherSegment, 1.0);

    $printed = function (Edition $edition) use ($work): string {
        $runs = test()->get(route('editions.show', [$work, $edition]))
            ->viewData('page')['props']['windowPassages'][0]['runs'];

        return implode(' ', array_column($runs, 'text'));
    };

    return ['first' => $printed($first), 'second' => $printed($second)];
}

test('an edition whose base did not seed the columns still prints only its base', function () {
    // The base's own reading spans three columns, so the two it covers hold
    // no reading of the base at all. Rendering them independently used to
    // splice in the seed witness's leftover words, printing
    // "the creature red fox sleeps" — a line neither manuscript has.
    $this->actingAs(User::factory()->editor()->create());

    $printed = printedByEachEdition('the swift red fox sleeps', 'the creature sleeps');

    expect($printed['second'])->toBe('the creature sleeps')
        ->and($printed['first'])->toBe('the swift red fox sleeps');
});

test('a base wordier than the columns prints its own wording, not the seed\'s', function () {
    $this->actingAs(User::factory()->editor()->create());

    $printed = printedByEachEdition('the fox sleeps', 'the exceedingly swift creature sleeps');

    expect($printed['second'])->toBe('the exceedingly swift creature sleeps')
        ->and($printed['first'])->toBe('the fox sleeps');
});

test('a run standing in for several columns says so', function () {
    $this->actingAs(User::factory()->editor()->create());

    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);

    $seed = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))
        ->create(['text' => 'the swift red fox sleeps']);
    $other = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))
        ->create(['text' => 'the creature sleeps']);
    TranscriptionSegment::factory()->for($seed)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 24]);
    $otherSegment = TranscriptionSegment::factory()->for($other)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 19]);

    $first = Edition::factory()->for($work)->create();
    PassageAdder::add($first, TranscriptionSegment::where('transcription_layer_id', $seed->id)->sole(), 1.0);

    $second = Edition::factory()->for($work)->create();
    PassageAdder::add($second, $otherSegment, 1.0);

    $this->get(route('editions.show', [$work, $second]))
        ->assertInertia(fn (AssertInertia $page) => $page
            // Three runs, not five: "creature" answers for the columns the
            // seed witness split into swift/red/fox.
            ->has('windowPassages.0.runs', 3)
            ->where('windowPassages.0.runs.1.text', 'creature')
            ->where('windowPassages.0.runs.1.range_end_lemma_id', fn ($id) => $id !== null));
});

test('a base that omits a word prints nothing there, not another witness\'s word', function () {
    // The base has no reading on that column at all — a genuine omission,
    // distinct from a column covered by a wider base reading. Rendering used
    // to fall back to the first candidate, so an edition based on the shorter
    // witness printed the longer one's extra word.
    $this->actingAs(User::factory()->editor()->create());

    $printed = printedByEachEdition('the swift red fox', 'the red fox');

    expect($printed['second'])->toBe('the  red fox') // the omitted column contributes nothing
        ->and($printed['first'])->toBe('the swift red fox');
});

test('a column the base omits is reported as a gap, and stays a variant site', function () {
    $this->actingAs(User::factory()->editor()->create());

    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);

    $seed = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))
        ->create(['text' => 'the swift red fox']);
    $shorter = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))
        ->create(['text' => 'the red fox']);
    TranscriptionSegment::factory()->for($seed)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 17]);
    $shorterSegment = TranscriptionSegment::factory()->for($shorter)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 11]);

    PassageAdder::add(Edition::factory()->for($work)->create(), TranscriptionSegment::where('transcription_layer_id', $seed->id)->sole(), 1.0);
    $second = Edition::factory()->for($work)->create();
    PassageAdder::add($second, $shorterSegment, 1.0);

    $runs = $this->get(route('editions.show', [$work, $second]))
        ->viewData('page')['props']['windowPassages'][0]['runs'];

    // The site survives so the editor can still adopt A's reading there.
    expect($runs[1]['gap'])->toBeTrue()
        ->and($runs[1]['text'])->toBe('')
        ->and($runs[1]['candidates'])->toHaveCount(1)
        ->and($runs[0]['gap'])->toBeFalse();
});
