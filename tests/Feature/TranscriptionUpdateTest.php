<?php

use App\Enums\Visibility;
use App\Models\TranscriptionLayer;
use App\Models\User;

test('a transcription\'s visibility can be published by any editor, not just its author', function () {
    $this->actingAs(User::factory()->editor()->create());
    $author = User::factory()->editor()->create();
    $transcription = TranscriptionLayer::factory()->for($author)->create(['text' => 'text']);

    $response = $this->patch(route('transcriptions.update', $transcription), [
        'visibility' => 'published',
    ]);

    $response->assertRedirect();
    expect($transcription->transcription->fresh()->visibility)->toBe(Visibility::Published);
});
