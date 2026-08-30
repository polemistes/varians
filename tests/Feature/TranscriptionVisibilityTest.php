<?php

use App\Enums\Visibility;
use App\Models\Transcription;
use App\Models\User;

test('anyone can view a published transcription', function () {
    $transcription = Transcription::factory()->published()->create();

    $response = $this->get(route('transcriptions.show', $transcription));

    $response->assertOk();
});

test('a guest cannot view a draft transcription', function () {
    $this->actingAs(User::factory()->create());
    $transcription = Transcription::factory()->create(['visibility' => Visibility::Draft]);

    $response = $this->get(route('transcriptions.show', $transcription));

    $response->assertForbidden();
});

test('an anonymous visitor cannot view a draft transcription', function () {
    $transcription = Transcription::factory()->create(['visibility' => Visibility::Draft]);

    $response = $this->get(route('transcriptions.show', $transcription));

    $response->assertForbidden();
});

test('any editor can view a draft transcription, not just its author', function () {
    $author = User::factory()->editor()->create();
    $viewer = User::factory()->editor()->create();
    $transcription = Transcription::factory()->for($author)->create(['visibility' => Visibility::Draft]);
    $this->actingAs($viewer);

    $response = $this->get(route('transcriptions.show', $transcription));

    $response->assertOk();
});

test('an administrator can view a draft transcription', function () {
    $this->actingAs(User::factory()->administrator()->create());
    $transcription = Transcription::factory()->create(['visibility' => Visibility::Draft]);

    $response = $this->get(route('transcriptions.show', $transcription));

    $response->assertOk();
});
