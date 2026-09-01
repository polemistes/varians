<?php

use App\Models\TranscriptionLayer;
use App\Models\User;

test('anyone can view a published transcription', function () {
    $transcription = TranscriptionLayer::factory()->published()->create();

    $response = $this->get(route('transcriptions.show', $transcription));

    // A layer is worked on at its witness, where the manuscript stands beside
    // it, so the old per-transcription URL sends you there.
    $response->assertRedirect(route('witnesses.show', [
        'witness' => $transcription->transcription->witness_id,
        'transcription' => $transcription->transcription_id,
        'layer' => $transcription->layer->value,
    ]));
});

test('a guest cannot view a draft transcription', function () {
    $this->actingAs(User::factory()->create());
    $transcription = TranscriptionLayer::factory()->create();

    $response = $this->get(route('transcriptions.show', $transcription));

    $response->assertForbidden();
});

test('an anonymous visitor cannot view a draft transcription', function () {
    $transcription = TranscriptionLayer::factory()->create();

    $response = $this->get(route('transcriptions.show', $transcription));

    $response->assertForbidden();
});

test('any editor can view a draft transcription, not just its author', function () {
    $author = User::factory()->editor()->create();
    $viewer = User::factory()->editor()->create();
    $transcription = TranscriptionLayer::factory()->for($author)->create();
    $this->actingAs($viewer);

    $response = $this->get(route('transcriptions.show', $transcription));

    // A layer is worked on at its witness, where the manuscript stands beside
    // it, so the old per-transcription URL sends you there.
    $response->assertRedirect(route('witnesses.show', [
        'witness' => $transcription->transcription->witness_id,
        'transcription' => $transcription->transcription_id,
        'layer' => $transcription->layer->value,
    ]));
});

test('an administrator can view a draft transcription', function () {
    $this->actingAs(User::factory()->administrator()->create());
    $transcription = TranscriptionLayer::factory()->create();

    $response = $this->get(route('transcriptions.show', $transcription));

    // A layer is worked on at its witness, where the manuscript stands beside
    // it, so the old per-transcription URL sends you there.
    $response->assertRedirect(route('witnesses.show', [
        'witness' => $transcription->transcription->witness_id,
        'transcription' => $transcription->transcription_id,
        'layer' => $transcription->layer->value,
    ]));
});
