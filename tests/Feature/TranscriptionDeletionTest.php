<?php

use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;

test('deleting a transcription cascades its segments and regions, redirects to its witness, and leaves the witness untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $image = ManuscriptImage::factory()->for($witness)->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();

    $response = $this->delete(route('transcriptions.destroy', $transcription));

    $response->assertRedirect(route('witnesses.show', $witness));
    expect(TranscriptionLayer::find($transcription->id))->toBeNull()
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
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    $editionLemma = EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    $editionPassage = EditionPassage::factory()->create(['transcription_layer_id' => $transcription->id]);

    $this->delete(route('transcriptions.destroy', $transcription));

    expect(LemmaReading::find($reading->id))->toBeNull()
        ->and(EditionLemma::find($editionLemma->id))->toBeNull()
        ->and(EditionPassage::find($editionPassage->id))->toBeNull();
});
