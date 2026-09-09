<?php

use App\Models\Edition;
use App\Models\Lemma;
use App\Models\TranscriptionLayer;
use App\Models\User;

/**
 * Withdrawing an edition's choice of reading. Choosing one is exercised
 * through edition-variants.store in EditionVariantControllerTest.
 */
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
