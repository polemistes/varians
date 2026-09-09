<?php

use App\Enums\Visibility;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;

test('a transcription is published by hand by its witness\'s owner — not by an invited or site-wide editor', function () {
    $owner = User::factory()->create();
    $witness = Witness::factory()->for($owner)->create();
    $transcription = TranscriptionLayer::factory()->for(Transcription::factory()->for($witness))->create(['text' => 'text']);

    $this->actingAs(User::factory()->editor()->create())
        ->patch(route('transcriptions.update', $transcription), ['visibility' => 'published'])
        ->assertForbidden();

    $this->actingAs($owner)
        ->patch(route('transcriptions.update', $transcription), ['visibility' => 'published'])
        ->assertRedirect();
    expect($transcription->transcription->fresh()->visibility)->toBe(Visibility::Published);

    $this->actingAs(User::factory()->administrator()->create())
        ->patch(route('transcriptions.update', $transcription), ['visibility' => 'draft'])
        ->assertRedirect();
    expect($transcription->transcription->fresh()->visibility)->toBe(Visibility::Draft);
});

test('a transcription a published edition cites cannot be taken back to a draft', function () {
    $owner = User::factory()->create();
    $witness = Witness::factory()->for($owner)->create();
    $layer = TranscriptionLayer::factory()->for(Transcription::factory()->for($witness))->create(['text' => 'the quick fox']);
    $edition = Edition::factory()->for($owner)->create(['visibility' => Visibility::Draft]);
    $passage = CanonicalPassage::factory()->for($edition->work)->create();
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);

    $this->actingAs($owner);
    $this->patch(route('editions.update', $edition), ['visibility' => 'published']);
    expect($layer->transcription->fresh()->visibility)->toBe(Visibility::Published);

    $this->patch(route('transcriptions.update', $layer), ['visibility' => 'draft'])
        ->assertSessionHasErrors('visibility');
    expect($layer->transcription->fresh()->visibility)->toBe(Visibility::Published);

    $this->patch(route('editions.update', $edition), ['visibility' => 'draft']);
    expect($layer->transcription->fresh()->visibility)->toBe(Visibility::Draft);
});
