<?php

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;

/**
 * A passage collated from witnesses given as `siglum => [normalized,
 * diplomatic]`, the first being the edition's base. A null diplomatic means
 * that witness has no such layer.
 *
 * @param  array<string, array{0: string, 1: ?string}>  $witnesses
 * @return array{work: Work, edition: Edition, passage: CanonicalPassage}
 */
function collatedWithLayers(array $witnesses, bool $publishDiplomatic = true): array
{
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);
    $edition = Edition::factory()->for($work)->create();
    $position = 1.0;

    foreach ($witnesses as $siglum => [$normalizedText, $diplomaticText]) {
        $witness = Witness::factory()->create(['siglum' => $siglum]);

        $normalized = Transcription::factory()->normalized()->for($witness)->published()
            ->create(['text' => $normalizedText]);
        $segment = TranscriptionSegment::factory()->for($normalized)->for($passage, 'canonicalPassage')
            ->create(['start_offset' => 0, 'end_offset' => mb_strlen($normalizedText)]);

        if ($diplomaticText !== null) {
            $diplomatic = Transcription::factory()->diplomatic()->for($witness)
                ->create(['text' => $diplomaticText]);

            if ($publishDiplomatic) {
                $diplomatic->update(['visibility' => 'published']);
            }

            TranscriptionSegment::factory()->for($diplomatic)->for($passage, 'canonicalPassage')
                ->create(['start_offset' => 0, 'end_offset' => mb_strlen($diplomaticText)]);
        }

        PassageAdder::add($edition, $segment, $position++);
    }

    return ['work' => $work, 'edition' => $edition, 'passage' => $passage];
}

function passagePayload(Work $work, Edition $edition): array
{
    return test()->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'][0];
}

test('each printed word carries what the base manuscript itself shows', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    $runs = passagePayload($work, $edition)['runs'];

    expect(array_column($runs, 'text'))->toBe(['τοσοῦτοι', 'μὲν', 'οὖν'])
        ->and(array_column($runs, 'diplomatic'))->toBe(['ΤΟΣΟΥΤΟΙ', 'ΜΕΝ', 'ΟΥΝ']);
});

test('the whole line is available as the manuscript has it', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    expect(passagePayload($work, $edition)['base_diplomatic'])->toBe('ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ');
});

test('a variant carries its own witness\'s diplomatic wording, not the base\'s', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
        'B' => ['τοσοῦτοι δὲ οὖν', 'ΤΟΣΟΥΤΟΙ ΔΕ ΟΥΝ'],
    ]);

    $candidates = passagePayload($work, $edition)['runs'][1]['candidates'];

    expect(collect($candidates)->map(fn ($c) => [$c['label'], $c['text'], $c['diplomatic']])->all())
        ->toBe([
            ['A', 'μὲν', 'ΜΕΝ'],
            ['B', 'δὲ', 'ΔΕ'],
        ]);
});

test('a conjecture has no diplomatic wording', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    $middle = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[1];
    $middle->readings()->create([
        'conjecture_id' => Conjecture::factory()->for($passage, 'canonicalPassage')->create(['text' => 'γὰρ'])->id,
    ]);

    $conjecture = collect(passagePayload($work, $edition)['runs'][1]['candidates'])
        ->firstWhere('conjecture_id', '!=', null);

    expect($conjecture['text'])->toBe('γὰρ')
        ->and($conjecture['diplomatic'])->toBeNull();
});

test('a witness with no diplomatic layer simply has none to show', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
    ]);

    $payload = passagePayload($work, $edition);

    expect($payload['base_diplomatic'])->toBeNull()
        ->and(array_column($payload['runs'], 'diplomatic'))->toBe([null, null, null]);
});

test('an unpublished diplomatic layer stays hidden from a reader', function () {
    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ], publishDiplomatic: false);

    $edition->update(['visibility' => 'published']);
    $this->actingAs(User::factory()->create()); // a reader, not an editor

    $payload = passagePayload($work, $edition);

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

    $payload = passagePayload($work, $edition);

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

    $candidates = passagePayload($work, $edition)['runs'][1]['candidates'];

    expect(collect($candidates)->map(fn ($c) => [$c['label'], $c['text'], $c['orthographic_only']])->all())
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

    $candidates = passagePayload($work, $edition)['runs'][1]['candidates'];

    expect(collect($candidates)->pluck('orthographic_only')->all())->toBe([false, false]);
});

test('a conjecture is never an orthographic variant', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition, 'passage' => $passage] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ'],
    ]);

    $middle = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[1];
    $middle->readings()->create([
        // Spelled the same but for the accent — still a proposal, not a variant.
        'conjecture_id' => Conjecture::factory()->for($passage, 'canonicalPassage')->create(['text' => 'μεν'])->id,
    ]);

    $conjecture = collect(passagePayload($work, $edition)['runs'][1]['candidates'])
        ->firstWhere('conjecture_id', '!=', null);

    expect($conjecture['orthographic_only'])->toBeFalse();
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

    expect(array_column(passagePayload($work, $edition)['runs'], 'orthographic_variation'))
        ->toBe([false, true, false]);
});

test('a site with a real difference of wording is not marked orthographic', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
        'B' => ['τοσοῦτοι δὲ οὖν', null],
    ]);

    expect(array_column(passagePayload($work, $edition)['runs'], 'orthographic_variation'))
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

    expect(passagePayload($work, $edition)['runs'][1]['orthographic_variation'])->toBeFalse();
});

test('where the witnesses agree there is nothing to attribute', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'edition' => $edition] = collatedWithLayers([
        'A' => ['τοσοῦτοι μὲν οὖν', null],
        'B' => ['τοσοῦτοι μὲν οὖν', null],
    ]);

    expect(array_column(passagePayload($work, $edition)['runs'], 'orthographic_variation'))
        ->toBe([false, false, false]);
});
