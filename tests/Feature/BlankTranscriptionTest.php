<?php

use App\Models\Transcription;
use App\Models\User;
use App\Models\Witness;

test('a blank transcription can be started for a witness, without importing any text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();

    $response = $this->post(route('witnesses.transcriptions.store', $witness));

    $transcription = Transcription::sole();
    $response->assertRedirect(route('transcriptions.show', $transcription));

    expect($transcription->witness_id)->toBe($witness->id)
        ->and($transcription->text)->toBe('')
        ->and($transcription->segments)->toBeEmpty();
});

test('a blank transcription can be started with initial tags', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();

    $this->post(route('witnesses.transcriptions.store', $witness), [
        'tags' => ['diplomatic'],
    ]);

    $transcription = Transcription::sole();
    expect($transcription->tags()->pluck('name')->all())->toBe(['diplomatic']);
});
