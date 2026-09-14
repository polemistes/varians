<?php

use App\Enums\Layer;
use App\Enums\Tokenization;
use App\Models\Assignment;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\Segment;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\DiplomaticCounterpart;
use App\Support\Edition\SegmentAdder;

/**
 * A segment collated from witnesses given as `siglum => [normalized,
 * diplomatic]`, the first being the edition's base. A null diplomatic means
 * that witness has no such layer.
 *
 * @param  array<string, array{0: string, 1: ?string}>  $witnesses
 * @return array{work: Work, edition: Edition, segment: Segment}
 */
function collatedWithLayers(array $witnesses, bool $publish = true): array
{
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);
    $edition = Edition::factory()->for($work)->create();
    $position = 1.0;

    foreach ($witnesses as $siglum => [$normalizedText, $diplomaticText]) {
        $witness = Witness::factory()->create(['siglum' => $siglum]);

        // Both layers belong to one transcription: a normalized layer's
        // diplomatic counterpart is its own sibling, not merely some layer of
        // the same manuscript, which may now be transcribed more than once.
        // Visibility belongs to the transcription: publish it and both layers
        // are visible, leave it a draft and neither is.
        $transcription = Transcription::factory()->for($witness)->create([
            'visibility' => $publish ? 'published' : 'draft',
        ]);

        $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)
            ->create(['text' => $normalizedText]);
        $assignment = Assignment::factory()->for($normalized)->for($segment, 'segment')
            ->create(['start_offset' => 0, 'end_offset' => mb_strlen($normalizedText)]);

        if ($diplomaticText !== null) {
            $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)
                ->create(['text' => $diplomaticText]);

            Assignment::factory()->for($diplomatic)->for($segment, 'segment')
                ->create(['start_offset' => 0, 'end_offset' => mb_strlen($diplomaticText)]);
        }

        SegmentAdder::add($edition, $assignment, $position++);
    }

    return ['work' => $work, 'edition' => $edition, 'segment' => $segment];
}

function segmentPayload(Work $work, Edition $edition): array
{
    return test()->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowSegments'][0];
}

test('each printed word carries what the base manuscript itself shows', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    $runs = segmentPayload($work, $edition)['runs'];

    expect(array_column($runs, 'text'))->toBe(['τοσοῦτοι', 'μὲν', 'οὖν'])
        ->and(array_column($runs, 'diplomatic'))->toBe(['ΤΟΣΟΥΤΟΙ', 'ΜΕΝ', 'ΟΥΝ']);
});

test('the whole line is available as the manuscript has it', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    expect(segmentPayload($work, $edition)['base_diplomatic'])->toBe('ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ');
});

test('a variant carries its own witness\'s diplomatic wording, not the base\'s', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
        'B' => ['τοσοῦτοι δὲ οὖν', 'ΤΟΣΟΥΤΟΙ ΔΕ ΟΥΝ'],
    ]);

    $candidates = segmentPayload($work, $edition)['runs'][1]['candidates'];

    expect(collect($candidates)->map(fn ($c) => [$c['label'], $c['text'], $c['diplomatic']])->all())
        ->toBe([
            ['A', 'μὲν', 'ΜΕΝ'],
            ['B', 'δὲ', 'ΔΕ'],
        ]);
});

test('the wire leaves a candidate\'s defaults out, and a spelling that is the text itself', function () {
    $this->actingAs(User::factory()->editor()->create());

    // B's diplomatic layer spells the word as the normalized one does.
    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
        'B' => ['τοσοῦτοι δὲ οὖν', 'ΤΟΣΟΥΤΟΙ δὲ ΟΥΝ'],
    ]);

    $run = segmentPayload($work, $edition)['runs'][1];

    // A plain witness reading is its label, text, reading and span — no
    // conjecture fields, no flags at their defaults (EditionController::
    // CANDIDATE_DEFAULTS, put back by lib/apparatus.ts inflateCandidate).
    expect(array_keys($run['candidates'][1]))
        ->toBe(['label', 'text', 'reading_id', 'transcription_layer_id', 'start_offset', 'end_offset'])
        ->and($run['candidates'][0]['diplomatic'])->toBe('ΜΕΝ')
        ->and($run)->not->toHaveKey('decided')
        ->and($run)->not->toHaveKey('gap')
        ->and($run)->not->toHaveKey('break_before');
});

test('a conjecture has no diplomatic wording', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'segment' => $segment] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    $middle = Lemma::where('segment_id', $segment->id)->orderBy('position')->get()[1];
    $middle->readings()->create([
        'conjecture_id' => Conjecture::factory()->for($segment, 'segment')->create(['text' => 'γὰρ'])->id,
    ]);

    $conjecture = collect(segmentPayload($work, $edition)['runs'][1]['candidates'])
        ->firstWhere('conjecture_id', '!=', null);

    expect($conjecture['text'])->toBe('γὰρ')
        ->and($conjecture['diplomatic'])->toBeNull();
});

test('a witness with no diplomatic layer simply has none to show', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
    ]);

    $payload = segmentPayload($work, $edition);

    expect($payload['base_diplomatic'])->toBeNull()
        ->and(array_column($payload['runs'], 'diplomatic'))->toBe([null, null, null]);
});

test('a draft transcription\'s diplomatic layer stays hidden from a reader', function () {
    // Not a layer of its own: a transcription is public or it is not, and if
    // it is, both of its layers are.
    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ], publish: false);

    $edition->update(['visibility' => 'published']);
    $this->actingAs(User::factory()->create()); // a reader, not an editor

    $payload = segmentPayload($work, $edition);

    expect($payload['base_diplomatic'])->toBeNull()
        ->and(array_column($payload['runs'], 'diplomatic'))->toBe([null, null, null]);
});

test('layers that divide the line differently report nothing rather than guessing', function () {
    // The normalized layer resolves a crasis into two words, so token
    // positions no longer correspond and no mapping can be trusted.
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['καὶ ἐγώ εἶπον', 'ΚΑΓΩ ΕΙΠΟΝ'],
    ]);

    $payload = segmentPayload($work, $edition);

    expect(array_column($payload['runs'], 'diplomatic'))->toBe([null, null, null])
        // The line as a whole is still readable — only the word-by-word
        // correspondence is untrustworthy.
        ->and($payload['base_diplomatic'])->toBe('ΚΑΓΩ ΕΙΠΟΝ');
});

test('a variant that differs only in accent is marked as orthographic', function () {
    // The case the editor most wants distinguished: one manuscript accents a
    // word and another does not, which is not a different reading.
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
        'B' => ['τοσοῦτοι μεν, οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    $candidates = segmentPayload($work, $edition)['runs'][1]['candidates'];

    expect(collect($candidates)->map(fn ($c) => [$c['label'], $c['text'], $c['orthographic_only'] ?? false])->all())
        ->toBe([
            ['A', 'μὲν', false],  // the base itself
            ['B', 'μεν,', true],  // same word, different pointing
        ]);
});

test('a genuinely different word is not marked as orthographic', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
        'B' => ['τοσοῦτοι δὲ οὖν', 'ΤΟΣΟΥΤΟΙ ΔΕ ΟΥΝ'],
    ]);

    $candidates = segmentPayload($work, $edition)['runs'][1]['candidates'];

    // Left out of the wire at its default — see EditionController::CANDIDATE_DEFAULTS.
    expect(collect($candidates)->map(fn ($c) => $c['orthographic_only'] ?? false)->all())->toBe([false, false]);
});

test('a conjecture is never an orthographic variant', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'segment' => $segment] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    $middle = Lemma::where('segment_id', $segment->id)->orderBy('position')->get()[1];
    $middle->readings()->create([
        // Spelled the same but for the accent — still a proposal, not a variant.
        'conjecture_id' => Conjecture::factory()->for($segment, 'segment')->create(['text' => 'μεν'])->id,
    ]);

    $conjecture = collect(segmentPayload($work, $edition)['runs'][1]['candidates'])
        ->firstWhere('conjecture_id', '!=', null);

    expect($conjecture['orthographic_only'] ?? false)->toBeFalse();
});

test('a site whose differences are all orthographic is marked as such', function () {
    // Collation reads the normalized layer, and accents are supplied there —
    // so a difference of accent alone is the editor's until a diplomatic
    // layer shows the scribes differing.
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
        'B' => ['τοσοῦτοι μεν, οὖν', null],
    ]);

    expect(array_map(fn (array $run) => $run['orthographic_variation'] ?? false, segmentPayload($work, $edition)['runs']))
        ->toBe([false, true, false]);
});

test('a site with a real difference of wording is not marked orthographic', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
        'B' => ['τοσοῦτοι δὲ οὖν', null],
    ]);

    expect(array_map(fn (array $run) => $run['orthographic_variation'] ?? false, segmentPayload($work, $edition)['runs']))
        ->toBe([false, false, false]);
});

test('a site is only orthographic when every difference at it is', function () {
    // One witness differing in accent and another in wording is a real
    // variant site, not an editorial artefact.
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
        'B' => ['τοσοῦτοι μεν οὖν', null],
        'C' => ['τοσοῦτοι δὲ οὖν', null],
    ]);

    expect(segmentPayload($work, $edition)['runs'][1]['orthographic_variation'] ?? false)->toBeFalse();
});

test('where the witnesses agree there is nothing to attribute', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
        'B' => ['τοσοῦτοι μὲν οὖν', null],
    ]);

    expect(array_map(fn (array $run) => $run['orthographic_variation'] ?? false, segmentPayload($work, $edition)['runs']))
        ->toBe([false, false, false]);
});

/**
 * A witness whose text for the segment is discontinuous in BOTH layers, split
 * the same way: "the quick" assigned in place, "fox" transposed to the head.
 *
 * @return array{segment: Segment, normalized: TranscriptionLayer, diplomatic: TranscriptionLayer}
 */
function splitLayers(): array
{
    $segment = Segment::factory()->create();
    $transcription = Transcription::factory()->create(['visibility' => 'published']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => "fox\nthe quick"]);
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)->create(['text' => "FOX\nTHE QUICK"]);

    foreach ([$normalized, $diplomatic] as $layer) {
        Assignment::factory()->for($layer)->for($segment, 'segment')
            ->create(['start_offset' => 4, 'end_offset' => 13, 'part' => 1]); // "the quick"
        Assignment::factory()->for($layer)->for($segment, 'segment')
            ->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]); // "fox"
    }

    return ['segment' => $segment, 'normalized' => $normalized, 'diplomatic' => $diplomatic];
}

test('a discontinuous segment reads part by part in the manuscript view, never as one contiguous line', function () {
    ['segment' => $segment, 'diplomatic' => $diplomatic] = splitLayers();

    expect(DiplomaticCounterpart::forSegment($segment, $diplomatic))
        ->toBe('THE QUICK … FOX');
});

test('the token-index mapping holds across parts, including a transposed one', function () {
    ['segment' => $segment, 'normalized' => $normalized, 'diplomatic' => $diplomatic] = splitLayers();

    // "fox" is the segment's LAST word by content but stands FIRST in the
    // text — the counterpart must come from the same content position.
    expect(DiplomaticCounterpart::forSpan($segment, $normalized, $diplomatic, 0, 3, Tokenization::Whitespace))
        ->toBe('FOX')
        ->and(DiplomaticCounterpart::forSpan($segment, $normalized, $diplomatic, 8, 13, Tokenization::Whitespace))
        ->toBe('QUICK');
});

test('the counterpart follows a layer\'s current text, never a cached earlier one', function () {
    // DiplomaticCounterpart caches a layer's tokens per model INSTANCE for
    // the length of a request. A fresh instance — another request, a test
    // reusing the id — must see the text as it now is.
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    expect(array_column(segmentPayload($work, $edition)['runs'], 'diplomatic'))->toBe(['ΤΟΣΟΥΤΟΙ', 'ΜΕΝ', 'ΟΥΝ']);

    TranscriptionLayer::where('layer', Layer::Diplomatic)->sole()->update(['text' => 'ΤΟΣΟΥΤΟΙ ΜΗΝ ΟΥΝ']);

    expect(array_column(segmentPayload($work, $edition)['runs'], 'diplomatic'))->toBe(['ΤΟΣΟΥΤΟΙ', 'ΜΗΝ', 'ΟΥΝ']);
});
