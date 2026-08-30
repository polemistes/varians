<?php

use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;

test('an editor can update another editor\'s transcription text', function () {
    $author = User::factory()->editor()->create();
    $editor = User::factory()->editor()->create();
    $transcription = Transcription::factory()->for($author)->create(['text' => 'old text']);
    $this->actingAs($editor);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 8, 'text' => 'new text']],
        'text' => 'new text',
    ]);

    $response->assertRedirect();
    expect($transcription->fresh()->text)->toBe('new text');
});

test('an editor can delete a segment created by another editor', function () {
    $author = User::factory()->editor()->create();
    $editor = User::factory()->editor()->create();
    $transcription = Transcription::factory()->for($author)->create(['text' => 'the quick fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create();
    $this->actingAs($editor);

    $response = $this->delete(route('transcription-segments.destroy', $segment));

    $response->assertRedirect();
    expect(TranscriptionSegment::find($segment->id))->toBeNull();
});

test('an editor can move a region on another editor\'s transcription', function () {
    $author = User::factory()->editor()->create();
    $editor = User::factory()->editor()->create();
    $transcription = Transcription::factory()->for($author)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->create(['x' => 0.1]);
    $this->actingAs($editor);

    $response = $this->patch(route('transcription-regions.update', $region), [
        'x' => 0.5, 'y' => 0.5, 'width' => 0.1, 'height' => 0.1,
    ]);

    $response->assertRedirect();
    expect((float) $region->fresh()->x)->toBe(0.5);
});

test('an administrator can also edit any editor\'s transcription', function () {
    $author = User::factory()->editor()->create();
    $admin = User::factory()->administrator()->create();
    $transcription = Transcription::factory()->for($author)->create(['text' => 'old text']);
    $this->actingAs($admin);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 0, 'end' => 8, 'text' => 'new text']],
        'text' => 'new text',
    ]);

    $response->assertRedirect();
    expect($transcription->fresh()->text)->toBe('new text');
});
