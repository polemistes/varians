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

test('a copy whose text no longer matches at either end imports nothing, and says so', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $source, $target] = spanCopyFixture();

    // A notice rather than a validation error: the paste itself succeeded,
    // and silence here left the editor believing the citations came along.
    $this->post(route('transcriptions.span-copies.store', $target), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 0, // "προοίμιον…" stands here, not the copied text
    ])->assertRedirect()
        ->assertValid()
        ->assertSessionHas('message', 'The copied text no longer matches its source — no citations or mappings were brought along.');

    expect($target->segments()->count())->toBe(0);
});

test('an imported citation reaches both layers of an in-step target transcript', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $source] = spanCopyFixture();

    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    TranscriptionSegment::factory()->for($source)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5]);

    // A target transcript in ANOTHER witness whose two layers are in step.
    $foreignTranscription = Transcription::factory()->create();
    $foreign = TranscriptionLayer::factory()->diplomatic()->for($foreignTranscription)
        ->create(['text' => 'ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ']);
    $foreignSibling = TranscriptionLayer::factory()->normalized()->for($foreignTranscription)
        ->create(['text' => 'μῆνιν ἄειδε θεά']);

    $this->post(route('transcriptions.span-copies.store', $foreign), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 0,
    ])->assertRedirect();

    // Done once: the import lands in the pasted-into layer AND its in-step
    // sibling, as one group-linked identity — exactly as assigning there
    // by hand would.
    $imported = $foreign->segments()->sole();
    $counterpart = $foreignSibling->segments()->sole();

    expect($imported->group_id)->not->toBeNull()
        ->and($counterpart->group_id)->toBe($imported->group_id)
        ->and($counterpart->canonical_passage_id)->toBe($passage->id)
        ->and([$counterpart->start_offset, $counterpart->end_offset])->toBe([0, 5]);
});

test('citations travel to another witness; facsimile mappings stay with their parchment', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$witness, $source] = spanCopyFixture();

    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    TranscriptionSegment::factory()->for($source)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5]);
    $image = ManuscriptImage::factory()->for($witness)->create();
    TranscriptionRegion::factory()->for($source)->for($image, 'manuscriptImage')
        ->create(['start_offset' => 6, 'end_offset' => 11, 'text' => 'ΑΕΙΔΕ']);

    $foreign = TranscriptionLayer::factory()->create(['text' => 'ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ']);

    $this->post(route('transcriptions.span-copies.store', $foreign), [
        'source_layer_id' => $source->id,
        'source_start' => 0,
        'source_end' => 15,
        'target_offset' => 0,
    ])->assertRedirect()
        ->assertSessionHas('message', 'Brought 1 citation along with the pasted text. Facsimile mappings stay with their own witness.');

    // Which passage a stretch of text is stays true wherever it goes; where
    // it sits on a manuscript page does not.
    expect($foreign->segments()->sole()->canonical_passage_id)->toBe($passage->id)
        ->and($foreign->regions()->count())->toBe(0);
});

test('a copy that cuts through a segment still carries the contained part of its citation', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $source, $target] = spanCopyFixture();

    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    // Cited span [0,11); the copy takes only [6,15) — the overlap [6,11)
    // is still genuine text of the passage.
    TranscriptionSegment::factory()->for($source)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 11]);

    $this->post(route('transcriptions.span-copies.store', $target), [
        'source_layer_id' => $source->id,
        'source_start' => 6,
        'source_end' => 15,
        'target_offset' => 16,
    ])->assertRedirect();

    $segment = $target->segments()->sole();

    expect([$segment->start_offset, $segment->end_offset])->toBe([16, 21])
        ->and($segment->canonical_passage_id)->toBe($passage->id)
        ->and($segment->needs_review)->toBeFalse();
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
