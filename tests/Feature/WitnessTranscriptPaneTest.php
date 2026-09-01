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
 * The `witnessTranscripts` prop behind the edition page's right-hand
 * manuscript pane: every visible layer of every witness, cut down to the
 * passages currently on screen.
 */

/**
 * A work whose two canonical passages are cited by one witness, with the
 * edition printing only the first. The transcript deliberately carries text
 * on both sides of the cited stretches, so a slice that failed to trim would
 * be obvious.
 *
 * @return array{work: Work, edition: Edition, witness: Witness, transcription: TranscriptionLayer, parent: Transcription}
 */
function citedTranscript(string $layer = 'normalized'): array
{
    $work = Work::factory()->create();
    $edition = Edition::factory()->for($work)->create();

    $first = CanonicalPassage::factory()->for($work)->create([
        'address' => ['line' => 1], 'sort_key' => '00000001', 'label' => '1',
    ]);
    $second = CanonicalPassage::factory()->for($work)->create([
        'address' => ['line' => 2], 'sort_key' => '00000002', 'label' => '2',
    ]);

    $witness = Witness::factory()->create(['siglum' => 'A']);
    $parent = Transcription::factory()->for($witness)->create();
    //                 0123456789...
    $text = 'XX alpha beta YY';
    $transcription = TranscriptionLayer::factory()->{$layer}()->for($parent)->published()
        ->create(['text' => $text]);

    $one = TranscriptionSegment::factory()->for($transcription)->for($first, 'canonicalPassage')
        ->create(['start_offset' => 3, 'end_offset' => 8]);
    TranscriptionSegment::factory()->for($transcription)->for($second, 'canonicalPassage')
        ->create(['start_offset' => 9, 'end_offset' => 13]);

    PassageAdder::add($edition, $one, 1.0);

    return compact('work', 'edition', 'witness', 'transcription', 'parent');
}

/**
 * @return array<int, array<string, mixed>>
 */
function witnessTranscripts(Work $work, Edition $edition): array
{
    return test()->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['witnessTranscripts'];
}

test('a transcript is trimmed to the passages on screen', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = citedTranscript();

    $pane = witnessTranscripts($work, $edition);

    // Only passage 1 is in the edition, so only its own stretch is sent —
    // neither the leading "XX " nor passage 2's "beta".
    expect($pane)->toHaveCount(1)
        ->and($pane[0]['siglum'])->toBe('A')
        ->and($pane[0]['text'])->toBe('alpha')
        ->and($pane[0]['covers_window'])->toBeTrue();
});

test('segment offsets are rebased onto the slice', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = citedTranscript();

    $segments = witnessTranscripts($work, $edition)[0]['segments'];

    // The segment sits at 3..8 of the full text; against the slice it must
    // start at 0, or AlignableText would render the label in the wrong place
    // — or drop it, since it discards any segment ending past the text.
    expect($segments)->toHaveCount(1)
        ->and($segments[0]['start_offset'])->toBe(0)
        ->and($segments[0]['end_offset'])->toBe(5)
        ->and($segments[0]['canonical_passage']['label'])->toBe('1');
});

test('both layers of a witness are offered', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'parent' => $parent] = citedTranscript();

    $passage = CanonicalPassage::where('work_id', $work->id)->orderBy('sort_key')->first();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($parent)->published()
        ->create(['text' => 'ΑΛΦΑ']);
    TranscriptionSegment::factory()->for($diplomatic)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    $pane = witnessTranscripts($work, $edition);

    // Diplomatic first: it is the manuscript itself, and the reason for
    // opening the pane.
    expect(array_column($pane, 'layer'))->toBe(['diplomatic', 'normalized'])
        ->and($pane[0]['text'])->toBe('ΑΛΦΑ');
});

test('a witness with nothing in the window says so rather than showing another passage', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = citedTranscript();

    // A second witness cites only passage 2, which this edition does not print.
    $other = Witness::factory()->create(['siglum' => 'B']);
    $elsewhere = TranscriptionLayer::factory()->normalized()->for($other)->published()
        ->create(['text' => 'gamma']);
    $second = CanonicalPassage::where('work_id', $work->id)->orderBy('sort_key', 'desc')->first();
    TranscriptionSegment::factory()->for($elsewhere)->for($second, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5]);

    $pane = collect(witnessTranscripts($work, $edition))->firstWhere('siglum', 'B');

    expect($pane['covers_window'])->toBeFalse()
        ->and($pane['text'])->toBe('');
});

test('a draft transcription stays out of the pane for a reader', function () {
    ['work' => $work, 'edition' => $edition] = citedTranscript();

    // Visibility belongs to the transcription, not to a layer, so a witness
    // still being worked on is hidden whole rather than layer by layer.
    $passage = CanonicalPassage::where('work_id', $work->id)->orderBy('sort_key')->first();
    $unfinished = Witness::factory()->create(['siglum' => 'Z']);
    $draft = Transcription::factory()->for($unfinished)->create(['visibility' => 'draft']);
    $layer = TranscriptionLayer::factory()->normalized()->for($draft)->create(['text' => 'ΑΛΦΑ']);
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    $edition->update(['visibility' => 'published']);
    $this->actingAs(User::factory()->create());

    expect(array_column(witnessTranscripts($work, $edition), 'siglum'))->toBe(['A']);

    $this->actingAs(User::factory()->editor()->create());

    expect(array_column(witnessTranscripts($work, $edition), 'siglum'))->toBe(['A', 'Z']);
});
