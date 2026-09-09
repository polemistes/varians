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
 * Deleting text deletes citations and image mappings; undoing the deletion
 * restores them all. The client's edit history snapshots the rows a
 * destructive op destroyed and posts them back here once the restored text
 * has saved.
 */
test('undoing a destructive edit restores the citations it deleted', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 4, 'end_offset' => 7, 'part' => 1]);

    // The destructive edit deletes the citation with its words...
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 7, 'text' => '']],
        'text' => 'the  sat',
    ])->assertRedirect();
    expect(TranscriptionSegment::find($segment->id))->toBeNull();

    // ...the undo restores the text...
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => 'cat']],
        'text' => 'the cat sat',
    ])->assertRedirect();

    // ...and the history's snapshot restores the row.
    $this->post(route('transcription-spans.restore', $transcription), [
        'segments' => [[
            'canonical_passage_id' => $passage->id,
            'start_offset' => 4,
            'end_offset' => 7,
            'part' => 1,
        ]],
    ])->assertRedirect();

    $restored = $transcription->segments()->sole();
    expect([$restored->start_offset, $restored->end_offset, $restored->part])
        ->toBe([4, 7, 1])
        ->and($restored->canonical_passage_id)->toBe($passage->id);
});

test('a restore is skipped where the landing words already carry the assignment', function () {
    // The undo of an unsaved lone cut completes the relocation pair and the
    // citation rides home before the restore posts — recreating it would
    // duplicate the assignment.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 4, 'end_offset' => 7, 'part' => 1]);

    $this->post(route('transcription-spans.restore', $transcription), [
        'segments' => [[
            'canonical_passage_id' => $passage->id,
            'start_offset' => 4,
            'end_offset' => 7,
            'part' => 1,
        ]],
    ])->assertRedirect();

    expect($transcription->segments()->count())->toBe(1);
});

test('a restored span must cover existing text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'short']);
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();

    $this->post(route('transcription-spans.restore', $transcription), [
        'segments' => [[
            'canonical_passage_id' => $passage->id,
            'start_offset' => 2,
            'end_offset' => 40,
            'part' => 1,
        ]],
    ])->assertInvalid(['segments.0.end_offset']);

    expect($transcription->segments()->count())->toBe(0);
});

test('a restored span heals its counterpart in an in-step sibling layer', function () {
    $this->actingAs(User::factory()->editor()->create());
    $parent = Transcription::factory()->create();
    $layer = TranscriptionLayer::factory()->normalized()->for($parent)->create(['text' => 'the cät sat']);
    $sibling = TranscriptionLayer::factory()->diplomatic()->for($parent)->create(['text' => 'the cat sat']);
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();

    $this->post(route('transcription-spans.restore', $layer), [
        'segments' => [[
            'canonical_passage_id' => $passage->id,
            'start_offset' => 4,
            'end_offset' => 7,
            'part' => 1,
        ]],
    ])->assertRedirect();

    expect($layer->segments()->count())->toBe(1)
        ->and($sibling->segments()->count())->toBe(1)
        ->and($sibling->segments()->sole()->canonical_passage_id)->toBe($passage->id);
});

test('a guest cannot restore citation spans', function () {
    $this->actingAs(User::factory()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the cat sat']);
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();

    $this->post(route('transcription-spans.restore', $transcription), [
        'segments' => [[
            'canonical_passage_id' => $passage->id,
            'start_offset' => 4,
            'end_offset' => 7,
            'part' => 1,
        ]],
    ])->assertForbidden();
});

test('undoing a destructive edit restores the image mappings it deleted', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $parent = Transcription::factory()->for($witness)->create();
    $transcription = TranscriptionLayer::factory()->diplomatic()->for($parent)->create(['text' => 'the cat sat']);
    $image = ManuscriptImage::factory()->for($witness)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')
        ->create(['start_offset' => 4, 'end_offset' => 7, 'text' => 'cat', 'x' => 10, 'y' => 20, 'width' => 30, 'height' => 5, 'position' => 1]);

    // The destructive edit deletes the mapping with its words...
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 7, 'text' => '']],
        'text' => 'the  sat',
    ])->assertRedirect();
    expect(TranscriptionRegion::find($region->id))->toBeNull();

    // ...the undo restores the text, and the snapshot restores the row,
    // geometry intact and excerpt recomputed from the restored text.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 4, 'text' => 'cat']],
        'text' => 'the cat sat',
    ])->assertRedirect();

    $this->post(route('transcription-spans.restore', $transcription), [
        'regions' => [[
            'manuscript_image_id' => $image->id,
            'start_offset' => 4,
            'end_offset' => 7,
            'position' => 1,
            'x' => 10, 'y' => 20, 'width' => 30, 'height' => 5,
        ]],
    ])->assertRedirect();

    $restored = $transcription->regions()->sole();
    expect([$restored->start_offset, $restored->end_offset])->toBe([4, 7])
        ->and($restored->text)->toBe('cat')
        ->and($restored->manuscript_image_id)->toBe($image->id)
        ->and((float) $restored->x)->toBe(10.0)
        ->and((float) $restored->width)->toBe(30.0);
});

test('a restored mapping is skipped where the target already maps overlapping text', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $parent = Transcription::factory()->for($witness)->create();
    $transcription = TranscriptionLayer::factory()->diplomatic()->for($parent)->create(['text' => 'the cat sat']);
    $image = ManuscriptImage::factory()->for($witness)->create();
    TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')
        ->create(['start_offset' => 2, 'end_offset' => 9, 'text' => 'e cat s']);

    $this->post(route('transcription-spans.restore', $transcription), [
        'regions' => [[
            'manuscript_image_id' => $image->id,
            'start_offset' => 4,
            'end_offset' => 7,
            'position' => 2,
            'x' => 0, 'y' => 0, 'width' => 1, 'height' => 1,
        ]],
    ])->assertRedirect();

    expect($transcription->regions()->count())->toBe(1);
});

test('a mapping whose image belongs to another witness is never restored here', function () {
    // A mapping is a fact about ONE parchment — same rule as span-copy.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'the cat sat']);
    $foreignImage = ManuscriptImage::factory()->for(Witness::factory())->create();

    $this->post(route('transcription-spans.restore', $transcription), [
        'regions' => [[
            'manuscript_image_id' => $foreignImage->id,
            'start_offset' => 4,
            'end_offset' => 7,
            'position' => 1,
            'x' => 0, 'y' => 0, 'width' => 1, 'height' => 1,
        ]],
    ])->assertRedirect();

    expect($transcription->regions()->count())->toBe(0);
});
