<?php

use App\Models\Edition;
use App\Models\Lemma;
use App\Models\TranscriptionLayer;
use App\Models\User;

test('an editor can choose which reading an edition prints for a lemma', function () {
    $this->actingAs(User::factory()->editor()->create());
    $lemma = Lemma::factory()->create();
    $first = $lemma->readings()->create([
        'transcription_layer_id' => TranscriptionLayer::factory()->create(['text' => 'foo'])->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ]);
    $second = $lemma->readings()->create([
        'transcription_layer_id' => TranscriptionLayer::factory()->create(['text' => 'bar'])->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ]);
    $edition = Edition::factory()->create();
    $edition->selections()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $first->id]);

    $response = $this->patch(route('edition-lemmas.select', [$edition, $lemma]), ['reading_id' => $second->id]);

    $response->assertRedirect();
    expect($edition->selections()->sole()->selected_reading_id)->toBe($second->id);
});

test('selecting a reading for a lemma an edition has never seen creates the selection', function () {
    $this->actingAs(User::factory()->editor()->create());
    $lemma = Lemma::factory()->create();
    $reading = $lemma->readings()->create([
        'transcription_layer_id' => TranscriptionLayer::factory()->create(['text' => 'foo'])->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ]);
    $edition = Edition::factory()->create();

    $response = $this->patch(route('edition-lemmas.select', [$edition, $lemma]), ['reading_id' => $reading->id]);

    $response->assertRedirect();
    expect($edition->selections()->sole()->selected_reading_id)->toBe($reading->id);
});

test('a reading from a different lemma cannot be selected', function () {
    $this->actingAs(User::factory()->editor()->create());
    $lemma = Lemma::factory()->create();
    $otherLemma = Lemma::factory()->create();
    $unrelatedReading = $otherLemma->readings()->create([
        'transcription_layer_id' => TranscriptionLayer::factory()->create(['text' => 'foo'])->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ]);
    $edition = Edition::factory()->create();

    $response = $this->patch(route('edition-lemmas.select', [$edition, $lemma]), ['reading_id' => $unrelatedReading->id]);

    $response->assertInvalid(['reading_id']);
});

test('removing an edition\'s selection leaves the shared lemma and reading untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $lemma = Lemma::factory()->create();
    $reading = $lemma->readings()->create([
        'transcription_layer_id' => TranscriptionLayer::factory()->create(['text' => 'foo'])->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ]);
    $edition = Edition::factory()->create();
    $edition->selections()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);

    $response = $this->delete(route('edition-lemmas.destroy', [$edition, $lemma]));

    $response->assertRedirect();
    expect($edition->selections()->count())->toBe(0)
        ->and(Lemma::find($lemma->id))->not->toBeNull()
        ->and($reading->fresh())->not->toBeNull();
});

test('removing one edition\'s selection does not affect another edition\'s selection for the same lemma', function () {
    $this->actingAs(User::factory()->editor()->create());
    $lemma = Lemma::factory()->create();
    $reading = $lemma->readings()->create([
        'transcription_layer_id' => TranscriptionLayer::factory()->create(['text' => 'foo'])->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ]);
    $editionA = Edition::factory()->create();
    $editionB = Edition::factory()->create();
    $editionA->selections()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    $editionB->selections()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);

    $this->delete(route('edition-lemmas.destroy', [$editionA, $lemma]));

    expect($editionA->selections()->count())->toBe(0)
        ->and($editionB->selections()->count())->toBe(1);
});

test('a guest cannot select a reading', function () {
    $this->actingAs(User::factory()->create());
    $lemma = Lemma::factory()->create();
    $reading = $lemma->readings()->create([
        'transcription_layer_id' => TranscriptionLayer::factory()->create(['text' => 'foo'])->id,
        'start_offset' => 0,
        'end_offset' => 3,
    ]);
    $edition = Edition::factory()->create();

    $response = $this->patch(route('edition-lemmas.select', [$edition, $lemma]), ['reading_id' => $reading->id]);

    $response->assertForbidden();
});
