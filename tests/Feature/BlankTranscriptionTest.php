<?php

use App\Enums\Layer;
use App\Models\Transcription;
use App\Models\User;
use App\Models\Witness;

test('a blank transcription can be started for a witness, without importing any text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();

    $response = $this->post(route('witnesses.transcriptions.store', $witness));

    // Starting a transcription creates both its layers at once — a
    // transcription always consists of the two — and lands the editor in the
    // normalized one.
    $transcription = Transcription::sole();
    $normalized = $transcription->normalized;

    $response->assertRedirect(route('transcriptions.show', $normalized));

    expect($transcription->witness_id)->toBe($witness->id)
        ->and($transcription->layers()->pluck('layer')->all())
        ->toEqualCanonicalizing([Layer::Diplomatic, Layer::Normalized])
        ->and($normalized->text)->toBe('')
        ->and($normalized->segments)->toBeEmpty()
        ->and($transcription->diplomatic->text)->toBe('');
});
