<?php

use App\Models\CanonicalPassage;
use App\Models\ManuscriptImage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;

/**
 * Copying text from one layer and pasting it into another brings the
 * citation assignments and facsimile mappings along — the client pairs the
 * copy with its paste and posts the source range and landing offset here
 * after the pasted text has been saved.
 */
function spanCopyFixture(): array
{
    $witness = Witness::factory()->create();
    $transcription = Transcription::factory()->for($witness)->create();
    $source = TranscriptionLayer::factory()->diplomatic()->for($transcription)
        ->create(['text' => 'ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ']);
    $target = TranscriptionLayer::factory()->normalized()->for($transcription)
        ->create(['text' => "προοίμιον\nΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ"]);

    return [$witness, $source, $target];
}

test('a pasted copy brings its citations and mappings, shifted to where it landed', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$witness, $source, $target] = spanCopyFixture();

    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    TranscriptionSegment::factory()->for($source)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5]);
    $image = ManuscriptImage::factory()->for($witness)->create();
    TranscriptionRegion::factory()->for($source)->for($image, 'manuscriptImage')
        ->create(['start_offset' => 6, 'end_offset' => 11, 'text' => 'ΑΕΙΔΕ']);

    // The whole source text was copied and pasted at offset 10 of the target.
    $this->post(route('transcriptions.span-copies.store', $target), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 10,
    ])->assertRedirect()
        ->assertSessionHas('message', 'Brought 1 citation and 1 facsimile mapping along with the pasted text.');

    $segment = $target->segments()->sole();
    $region = $target->regions()->sole();

    expect([$segment->start_offset, $segment->end_offset])->toBe([10, 15])
        ->and($segment->canonical_passage_id)->toBe($passage->id)
        ->and([$region->start_offset, $region->end_offset])->toBe([16, 21])
        ->and($region->manuscript_image_id)->toBe($image->id);
});

test('a copied citation joins a passage the target already cites, as a further part', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $source, $target] = spanCopyFixture();

    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    TranscriptionSegment::factory()->for($source)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5]);
    TranscriptionSegment::factory()->for($target)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 9, 'part' => 1]);

    $this->post(route('transcriptions.span-copies.store', $target), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 10,
    ])->assertRedirect();

    expect($target->segments()->where('start_offset', 10)->sole()->part)->toBe(2);
});

test('a copied mapping is skipped where the target already maps overlapping text', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$witness, $source, $target] = spanCopyFixture();

    $image = ManuscriptImage::factory()->for($witness)->create();
    TranscriptionRegion::factory()->for($source)->for($image, 'manuscriptImage')
        ->create(['start_offset' => 6, 'end_offset' => 11, 'text' => 'ΑΕΙΔΕ']);
    // Target already maps text overlapping where the copy would land.
    TranscriptionRegion::factory()->for($target)->for($image, 'manuscriptImage')
        ->create(['start_offset' => 14, 'end_offset' => 25, 'text' => 'x']);

    $this->post(route('transcriptions.span-copies.store', $target), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 10,
    ])->assertRedirect()
        ->assertSessionMissing('message');

    expect($target->regions()->count())->toBe(1);
});

test('a copy whose text no longer matches at either end imports nothing', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $source, $target] = spanCopyFixture();

    $this->post(route('transcriptions.span-copies.store', $target), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 0, // "προοίμιον…" stands here, not the copied text
    ])->assertInvalid(['target_offset']);
});

test('spans do not travel between layers of different witnesses', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $source] = spanCopyFixture();
    $foreign = TranscriptionLayer::factory()->create(['text' => 'ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ']);

    $this->post(route('transcriptions.span-copies.store', $foreign), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 0,
    ])->assertInvalid(['source_layer_id']);
});

test('a guest cannot import spans', function () {
    $this->actingAs(User::factory()->create());
    [, $source, $target] = spanCopyFixture();

    $this->post(route('transcriptions.span-copies.store', $target), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 10,
    ])->assertForbidden();
});
