<?php

use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;

test('deleting a transcript removes BOTH its layers with their segments and regions, redirects to its witness, and leaves the witness untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $image = ManuscriptImage::factory()->for($witness)->create();
    $parent = Transcription::factory()->for($witness)->create();
    $transcription = TranscriptionLayer::factory()->diplomatic()->for($parent)->create();
    $sibling = TranscriptionLayer::factory()->normalized()->for($parent)->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();

    $response = $this->delete(route('transcriptions.destroy', $transcription));

    // Deleting only the pressed pane's layer left one-layer transcripts
    // behind (real incident); a transcript is the pair.
    $response->assertRedirect(route('witnesses.show', $witness));
    expect(Transcription::find($parent->id))->toBeNull()
        ->and(TranscriptionLayer::find($transcription->id))->toBeNull()
        ->and(TranscriptionLayer::find($sibling->id))->toBeNull()
        ->and(TranscriptionSegment::find($segment->id))->toBeNull()
        ->and(TranscriptionRegion::find($region->id))->toBeNull()
        ->and(Witness::find($witness->id))->not->toBeNull()
        ->and(ManuscriptImage::find($image->id))->not->toBeNull();
});

test('a copy of a deleted layer survives, with its provenance link cleared', function () {
    $this->actingAs(User::factory()->editor()->create());
    $original = TranscriptionLayer::factory()->create();
    $fork = TranscriptionLayer::factory()->create(['copied_from_id' => $original->id]);

    $this->delete(route('transcriptions.destroy', $original));

    $fork->refresh();
    expect(TranscriptionLayer::find($original->id))->toBeNull()
        ->and($fork->copied_from_id)->toBeNull();
});

test('deleting a transcription that feeds a published edition removes that edition\'s selection and edition-passage membership', function () {
    $owner = User::factory()->create();
    $this->actingAs($owner);
    $transcription = TranscriptionLayer::factory()->for(Witness::factory()->for($owner))->create();

    // Her own edition: hers to gut along with the transcript.
    $edition = Edition::factory()->for($owner)->create();
    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    $editionLemma = EditionLemma::factory()->create(['edition_id' => $edition->id, 'lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    $editionPassage = EditionPassage::factory()->create(['edition_id' => $edition->id, 'transcription_layer_id' => $transcription->id]);

    $this->delete(route('transcriptions.destroy', $transcription));

    expect(LemmaReading::find($reading->id))->toBeNull()
        ->and(EditionLemma::find($editionLemma->id))->toBeNull()
        ->and(EditionPassage::find($editionPassage->id))->toBeNull();
});

test('a transcript another member\'s edition prints from cannot be deleted, and says why', function () {
    $owner = User::factory()->create();
    $layer = TranscriptionLayer::factory()->for(Witness::factory()->for($owner))->create();
    EditionPassage::factory()->create([
        'edition_id' => Edition::factory()->create()->id,
        'transcription_layer_id' => $layer->id,
    ]);

    $this->actingAs($owner)
        ->delete(route('transcriptions.destroy', $layer))
        ->assertSessionHasErrors('transcript');

    expect(TranscriptionLayer::find($layer->id))->not->toBeNull();
});
