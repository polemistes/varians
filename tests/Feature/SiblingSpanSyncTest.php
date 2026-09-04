<?php

use App\Models\ManuscriptImage;
use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;

/**
 * An assignment or mapping is DONE ONCE: made in either layer, it appears
 * in both — projected through the shared word skeleton into each layer's
 * own spelling. Only an in-step sibling is written to.
 */
function inStepLayers(): array
{
    $transcription = Transcription::factory()->create();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)
        ->create(['text' => 'γιγνεται παντα ρει']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)
        ->create(['text' => 'γίνεται πάντα ῥεῖ']);

    return [$diplomatic, $normalized];
}

test('assigning in one layer cites the same words in the other', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = inStepLayers();
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    // Cite "παντα" (words 1..2) in the diplomatic layer.
    $this->post(route('transcription-segments.store', $diplomatic), [
        'work_id' => $work->id,
        'label' => '1.2',
        'start_offset' => 9,
        'end_offset' => 14,
    ])->assertRedirect()->assertSessionHasNoErrors();

    $mirrored = $normalized->segments()->sole();

    // The same WORD, in the normalized layer's own spelling: "πάντα".
    expect(mb_substr($normalized->text, $mirrored->start_offset, $mirrored->end_offset - $mirrored->start_offset))
        ->toBe('πάντα');
});

test('an out-of-step sibling is left alone', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = inStepLayers();
    $normalized->update(['text' => 'γίνεται πάντα']); // one word short
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    $this->post(route('transcription-segments.store', $diplomatic), [
        'work_id' => $work->id,
        'label' => '1.2',
        'start_offset' => 9,
        'end_offset' => 14,
    ])->assertRedirect();

    expect($normalized->segments()->count())->toBe(0);
});

test('removing a span removes its counterpart', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = inStepLayers();
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    $this->post(route('transcription-segments.store', $diplomatic), [
        'work_id' => $work->id,
        'label' => '1.2',
        'start_offset' => 9,
        'end_offset' => 14,
    ]);

    $this->delete(route('transcription-segments.destroy', $diplomatic->segments()->sole()))
        ->assertRedirect();

    expect(TranscriptionSegment::count())->toBe(0);
});

test('mapping text to the facsimile maps the same words in the other layer', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = inStepLayers();
    $image = ManuscriptImage::factory()->for($diplomatic->transcription->witness)->create();

    $this->post(route('transcription-regions.store', $diplomatic), [
        'manuscript_image_id' => $image->id,
        'text' => 'παντα',
        'start_offset' => 9,
        'end_offset' => 14,
        'x' => 0.1, 'y' => 0.2, 'width' => 0.1, 'height' => 0.05,
    ])->assertRedirect();

    $mirrored = $normalized->regions()->sole();

    expect($mirrored->text)->toBe('πάντα')
        ->and((float) $mirrored->x)->toBe(0.1);
});

test('deleting a mapping deletes its counterpart; moving one moves both boxes', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = inStepLayers();
    $image = ManuscriptImage::factory()->for($diplomatic->transcription->witness)->create();

    $this->post(route('transcription-regions.store', $diplomatic), [
        'manuscript_image_id' => $image->id,
        'text' => 'παντα',
        'start_offset' => 9,
        'end_offset' => 14,
        'x' => 0.1, 'y' => 0.2, 'width' => 0.1, 'height' => 0.05,
    ]);

    $region = $diplomatic->regions()->sole();

    $this->patch(route('transcription-regions.update', $region), [
        'x' => 0.5, 'y' => 0.5, 'width' => 0.2, 'height' => 0.1,
    ])->assertRedirect();

    expect((float) $normalized->regions()->sole()->x)->toBe(0.5);

    $this->delete(route('transcription-regions.destroy', $region))->assertRedirect();

    expect(TranscriptionRegion::count())->toBe(0);
});

test('the counterpart link survives the layers drifting apart', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = inStepLayers();
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    $this->post(route('transcription-segments.store', $diplomatic), [
        'work_id' => $work->id,
        'label' => '1.2',
        'start_offset' => 9,
        'end_offset' => 14,
    ]);

    // The layers drift: word-range matching would now miss the counterpart,
    // but the pair is ONE identity, linked by group.
    $normalized->update(['text' => 'γίνεται πάντα ῥεῖ ὥσπερ ποταμός']);

    $this->delete(route('transcription-segments.destroy', $diplomatic->segments()->sole()))
        ->assertRedirect();

    expect(TranscriptionSegment::count())->toBe(0);
});

test('a span assigned while the layers were apart heals when they come back in step', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = inStepLayers();
    $normalized->update(['text' => 'γίνεται πάντα']); // out of step: a word short
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();

    // Assigned one-sided — the sibling cannot receive it yet.
    $this->post(route('transcription-segments.store', $diplomatic), [
        'work_id' => $work->id,
        'label' => '1.2',
        'start_offset' => 9,
        'end_offset' => 14,
    ]);

    expect($normalized->segments()->count())->toBe(0);

    // The catch-up edit that restores the word skeleton (a save through the
    // text pipeline runs the healing pass).
    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [['start' => 13, 'end' => 13, 'text' => ' ῥεῖ']],
        'text' => 'γίνεται πάντα ῥεῖ',
    ])->assertRedirect();

    $healed = $normalized->segments()->sole();

    expect(mb_substr($normalized->fresh()->text, $healed->start_offset, $healed->end_offset - $healed->start_offset))
        ->toBe('πάντα')
        ->and($healed->group_id)->toBe($diplomatic->segments()->sole()->group_id);
});
