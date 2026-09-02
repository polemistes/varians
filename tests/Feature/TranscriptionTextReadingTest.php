<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Support\Edition\PassageAligner;

/**
 * Collate one transcription into a passage and return its readings keyed by
 * the word each was taken from.
 */
function collatedReadings(TranscriptionLayer $transcription, string $text): array
{
    $passage = CanonicalPassage::factory()->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);

    PassageAligner::alignWitness($passage, collect([$segment]));

    return Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')
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

test('editing a word transforms the reading collated from it', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    // Replace "quick" (4-9) with "slow" — the exact case that used to leave
    // the apparatus reading "the" / "slow " / "ox".
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 9, 'text' => 'slow']],
        'text' => 'the slow fox',
    ])->assertRedirect();

    expect(readingText($readings['the']))->toBe('the')
        ->and(readingText($readings['quick']))->toBe('slow')
        ->and(readingText($readings['fox']))->toBe('fox');
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

test('an edit partially clobbering a reading flags it without prompting', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    // Replace "ick f" — straddles the "quick" and "fox" readings.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 6, 'end' => 11, 'text' => 'X']],
        'text' => 'the quXox',
    ])->assertRedirect();

    expect($readings['quick']->fresh()->needs_review)->toBeTrue()
        ->and($readings['fox']->fresh()->needs_review)->toBeTrue();
});

test('a destroyed reading nothing selected is removed, with no prompt', function () {
    // The case that motivated dropping the prompt: no edition prints this
    // witness here, so there is nothing to decide and nothing to report.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 3, 'end' => 9, 'text' => '']],
        'text' => 'the fox',
    ])->assertRedirect()->assertSessionHasNoErrors();

    expect($transcription->fresh()->text)->toBe('the fox')
        ->and(LemmaReading::whereKey($readings['quick']->id)->exists())->toBeFalse()
        ->and(readingText($readings['fox']))->toBe('fox')
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

    $passage = CanonicalPassage::factory()->create();
    foreach ([$printed, $other] as $t) {
        PassageAligner::alignWitness($passage, collect([TranscriptionSegment::factory()->for($t)
            ->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13])]));
    }

    $middle = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->get()[1];
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
