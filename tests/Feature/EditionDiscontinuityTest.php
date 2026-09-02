<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;

/**
 * Two passages, two witnesses. A cites both contiguously; B's text for 1.1 is
 * split — "the quick" in place, "fox" transposed to after 1.2.
 *
 * @return array{work: Work, edition: Edition}
 */
function editionWithSplitWitness(): array
{
    $work = Work::factory()->create();
    $one = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);
    $two = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 2], 'sort_key' => '00000001.00000002', 'label' => '1.2',
    ]);
    $edition = Edition::factory()->for($work)->create();

    $layerFor = function (string $siglum, string $text): TranscriptionLayer {
        $transcription = Transcription::factory()
            ->for(Witness::factory()->create(['siglum' => $siglum]))
            ->create(['visibility' => 'published']);

        return TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => $text]);
    };

    $a = $layerFor('A', "the quick fox\nline two");
    $aOne = TranscriptionSegment::factory()->for($a)->for($one, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);
    $aTwo = TranscriptionSegment::factory()->for($a)->for($two, 'canonicalPassage')->create(['start_offset' => 14, 'end_offset' => 22]);

    $b = $layerFor('B', "the quick\nline two\nfox");
    TranscriptionSegment::factory()->for($b)->for($one, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 9, 'part' => 1]); // "the quick"
    TranscriptionSegment::factory()->for($b)->for($two, 'canonicalPassage')->create(['start_offset' => 10, 'end_offset' => 18]); // "line two"
    TranscriptionSegment::factory()->for($b)->for($one, 'canonicalPassage')->create(['start_offset' => 19, 'end_offset' => 22, 'part' => 2]); // "fox"

    PassageAdder::add($edition, $aOne, 1.0);
    PassageAdder::add($edition, $aTwo, 2.0);

    return ['work' => $work, 'edition' => $edition];
}

test('a witness holding a passage in two places is reported on that passage, with where each part stands', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionWithSplitWitness();

    $passages = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'];

    expect($passages[0]['label'])->toBe('1.1')
        ->and($passages[0]['discontinuous_witnesses'])->toBe([
            [
                'siglum' => 'B',
                'parts' => [
                    ['part' => 1, 'after_label' => null],
                    ['part' => 2, 'after_label' => '1.2'],
                ],
            ],
        ])
        ->and($passages[1]['discontinuous_witnesses'])->toBe([]);
});

test('a sub-passage transposition does not register as a whole-passage order divergence', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionWithSplitWitness();

    $passages = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'];

    // B's earliest span for 1.1 still precedes 1.2, so passage order agrees
    // everywhere; the split is reported per passage, never as an order range.
    expect(array_column($passages, 'order_range'))->toBe([null, null]);
});

test('the apparatus of a split-cited passage carries the witness\'s full text', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = editionWithSplitWitness();

    $runs = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'][0]['runs'];

    // Three columns — the/quick/fox — each attested by both witnesses, B's
    // transposed "fox" included.
    expect($runs)->toHaveCount(3);

    foreach ($runs as $run) {
        expect(array_column($run['candidates'], 'label'))->toBe(['A', 'B']);
    }
});
