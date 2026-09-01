<?php

use App\Enums\Layer;
use App\Models\CanonicalPassage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;

/**
 * Copying a layer's text into another. What travels with it depends on
 * whether the copy stays inside the same transcription — that is, whether it
 * still describes the same physical document.
 */

/** A diplomatic layer with one citation span and one image alignment. */
function layerToCopy(): TranscriptionLayer
{
    $transcription = Transcription::factory()->create();
    $layer = TranscriptionLayer::factory()->diplomatic()->for($transcription)
        ->create(['text' => 'ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ']);
    TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => '']);

    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 8]);
    TranscriptionRegion::factory()->for($layer)->create();

    return $layer;
}

test('copying into the other layer of the same transcription brings the mappings with it', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = layerToCopy();

    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => $layer->transcription_id,
    ])->assertRedirect();

    $normalized = $layer->transcription->fresh()->normalized;

    // The other layer is this same manuscript text regularized, standing on
    // the same pages and the same marks on parchment.
    expect($normalized->text)->toBe('ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ')
        ->and($normalized->copied_from_id)->toBe($layer->id)
        ->and($normalized->segments)->toHaveCount(1)
        ->and($normalized->segments->first()->start_offset)->toBe(0)
        ->and($normalized->segments->first()->end_offset)->toBe(8)
        ->and($normalized->regions)->toHaveCount(1);
});

test('copying into another transcription keeps the citations but drops the image alignments', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = layerToCopy();

    $elsewhere = Transcription::factory()->for(Witness::factory())->create();
    TranscriptionLayer::factory()->diplomatic()->for($elsewhere)->create(['text' => '']);

    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => $elsewhere->id,
    ])->assertRedirect();

    $copy = $elsewhere->fresh()->diplomatic;

    // Which passage of a work a stretch of text is stays true wherever it
    // goes; where it sits on a manuscript page does not.
    expect($copy->text)->toBe('ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ')
        ->and($copy->segments)->toHaveCount(1)
        ->and($copy->regions)->toBeEmpty();
});

test('a copy into another transcription lands in the corresponding layer', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = layerToCopy();

    $elsewhere = Transcription::factory()->create();

    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => $elsewhere->id,
    ])->assertRedirect();

    expect($elsewhere->fresh()->diplomatic->text)->toBe('ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ')
        ->and($elsewhere->fresh()->normalized)->toBeNull();
});

test('copying leaves the source untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = layerToCopy();

    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => $layer->transcription_id,
    ]);

    expect($layer->fresh()->text)->toBe('ΤΟΣΟΥΤΟΙ ΜΕΝ ΟΥΝ')
        ->and($layer->fresh()->segments)->toHaveCount(1);
});

test('copying over a layer that already has text is refused', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = layerToCopy();
    $layer->transcription->normalized->update(['text' => 'τοσοῦτοι μὲν οὖν']);

    // Overwriting would take that layer's citation spans, image regions and
    // any collated readings with it, so it is refused rather than confirmed.
    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => $layer->transcription_id,
    ])->assertInvalid(['transcription_id']);

    expect($layer->transcription->fresh()->normalized->text)->toBe('τοσοῦτοι μὲν οὖν');
});

test('a copy cannot target a transcription that does not exist', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = layerToCopy();

    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => 999999,
    ])->assertInvalid(['transcription_id']);
});

test('an editor can copy another editor\'s draft layer — editing here is fully collaborative', function () {
    $this->actingAs(User::factory()->editor()->create());
    $author = User::factory()->editor()->create();
    $transcription = Transcription::factory()->create();
    $layer = TranscriptionLayer::factory()->diplomatic()->for($transcription)->for($author)
        ->create(['text' => 'ΑΛΦΑ']);

    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => $transcription->id,
    ])->assertRedirect();

    expect($transcription->fresh()->normalized->text)->toBe('ΑΛΦΑ');
});

test('a guest cannot copy a layer', function () {
    $this->actingAs(User::factory()->create());
    $layer = layerToCopy();

    $this->post(route('transcriptions.copy.store', $layer), [
        'transcription_id' => $layer->transcription_id,
    ])->assertForbidden();
});
