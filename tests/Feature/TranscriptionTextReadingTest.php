<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Support\Edition\PassageAligner;

/**
 * Collate one transcription into a passage and return its readings keyed by
 * the word each was taken from.
 */
function collatedReadings(Transcription $transcription, string $text): array
{
    $passage = CanonicalPassage::factory()->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);

    PassageAligner::alignWitness($passage, $segment);

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
    $text = $reading->transcription->fresh()->text;

    return mb_substr($text, $reading->start_offset, $reading->end_offset - $reading->start_offset);
}

test('editing a word transforms the reading collated from it', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
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
    $transcription = Transcription::factory()->create(['text' => 'the fox']);
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
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    // Replace "ick f" — straddles the "quick" and "fox" readings.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 6, 'end' => 11, 'text' => 'X']],
        'text' => 'the quXox',
    ])->assertRedirect();

    expect($readings['quick']->fresh()->needs_review)->toBeTrue()
        ->and($readings['fox']->fresh()->needs_review)->toBeTrue();
});

test('an edit destroying a reading is refused until the editor chooses', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 3, 'end' => 9, 'text' => '']],
        'text' => 'the fox',
    ]);

    $response->assertInvalid(['lost_readings']);

    // Nothing was written — not the text, not the readings.
    expect($transcription->fresh()->text)->toBe('the quick fox')
        ->and(LemmaReading::whereKey($readings['quick']->id)->exists())->toBeTrue();
});

test('the refusal names how many readings and edition selections are at stake', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    EditionLemma::create([
        'edition_id' => Edition::factory()->create()->id,
        'lemma_id' => $readings['quick']->lemma_id,
        'selected_reading_id' => $readings['quick']->id,
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 3, 'end' => 9, 'text' => '']],
        'text' => 'the fox',
    ]);

    $response->assertInvalid([
        'lost_readings' => 'This edit removes the text 1 collated reading was taken from, including 1 lemma selection in an edition.',
    ]);
});

test('choosing keep collapses the reading, flags it, and preserves the edition selection', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    $selection = EditionLemma::create([
        'edition_id' => Edition::factory()->create()->id,
        'lemma_id' => $readings['quick']->lemma_id,
        'selected_reading_id' => $readings['quick']->id,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 3, 'end' => 9, 'text' => '']],
        'text' => 'the fox',
        'lost_readings' => 'keep',
    ])->assertRedirect();

    $lost = $readings['quick']->fresh();

    expect($transcription->fresh()->text)->toBe('the fox')
        ->and($lost)->not->toBeNull()
        ->and($lost->needs_review)->toBeTrue()
        ->and($lost->start_offset)->toBe($lost->end_offset) // collapsed at the edit point
        ->and(EditionLemma::whereKey($selection->id)->exists())->toBeTrue();

    // The surviving readings still resolve correctly against the new text.
    expect(readingText($readings['fox']))->toBe('fox');
});

test('choosing delete removes the reading and lets its edition selection cascade', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    $selection = EditionLemma::create([
        'edition_id' => Edition::factory()->create()->id,
        'lemma_id' => $readings['quick']->lemma_id,
        'selected_reading_id' => $readings['quick']->id,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 3, 'end' => 9, 'text' => '']],
        'text' => 'the fox',
        'lost_readings' => 'delete',
    ])->assertRedirect();

    expect($transcription->fresh()->text)->toBe('the fox')
        ->and(LemmaReading::whereKey($readings['quick']->id)->exists())->toBeFalse()
        ->and(EditionLemma::whereKey($selection->id)->exists())->toBeFalse();
});

test('a conjecture reading has no offsets and is never touched by a text edit', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
    $readings = collatedReadings($transcription, 'the quick fox');

    $conjecture = LemmaReading::factory()->create([
        'lemma_id' => $readings['quick']->lemma_id,
        'transcription_id' => null,
        'start_offset' => null,
        'end_offset' => null,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 13, 'text' => 'wholly new text']],
        'text' => 'wholly new text',
        'lost_readings' => 'delete',
    ])->assertRedirect();

    $conjecture->refresh();

    expect($conjecture->start_offset)->toBeNull()
        ->and($conjecture->end_offset)->toBeNull()
        ->and($conjecture->needs_review)->toBeFalse();
});
