<?php

use App\Enums\Visibility;
use App\Models\Tag;
use App\Models\TranscriptionLayer;
use App\Models\User;

test('tags can be set on a transcription, creating them as needed', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create();

    $response = $this->patch(route('transcriptions.update', $transcription), [
        'tags' => ['diplomatic', 'punctuated'],
    ]);

    $response->assertRedirect();
    expect($transcription->tags()->pluck('name')->sort()->values()->all())
        ->toBe(['diplomatic', 'punctuated']);
});

test('setting tags reuses an existing tag rather than duplicating it', function () {
    $this->actingAs(User::factory()->editor()->create());
    $tag = Tag::factory()->create(['name' => 'diplomatic']);
    $transcription = TranscriptionLayer::factory()->create();

    $this->patch(route('transcriptions.update', $transcription), [
        'tags' => ['diplomatic'],
    ]);

    expect(Tag::where('name', 'diplomatic')->count())->toBe(1)
        ->and($transcription->tags()->first()->id)->toBe($tag->id);
});

test('setting tags again replaces the previous set', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create();
    $transcription->tags()->attach(Tag::factory()->create(['name' => 'stale']));

    $this->patch(route('transcriptions.update', $transcription), [
        'tags' => ['fresh'],
    ]);

    expect($transcription->tags()->pluck('name')->all())->toBe(['fresh']);
});

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
