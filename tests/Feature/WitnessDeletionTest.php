<?php

use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;

test('deleting a witness cascades its pages, images, transcriptions, and their spans, and redirects home', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $image = ManuscriptImage::factory()->for($witness)->create();
    $feature = ManuscriptImageFeature::factory()->for($image, 'manuscriptImage')->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();

    $response = $this->delete(route('witnesses.destroy', $witness));

    $response->assertRedirect(route('home'));
    expect(Witness::find($witness->id))->toBeNull()
        ->and(ManuscriptImage::find($image->id))->toBeNull()
        ->and(ManuscriptImageFeature::find($feature->id))->toBeNull()
        ->and(TranscriptionLayer::find($transcription->id))->toBeNull()
        ->and(TranscriptionSegment::find($segment->id))->toBeNull()
        ->and(TranscriptionRegion::find($region->id))->toBeNull();
});

test('deleting a witness whose transcription feeds a published edition removes that edition\'s selection and edition-passage membership', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    $editionLemma = EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    $editionPassage = EditionPassage::factory()->create(['transcription_layer_id' => $transcription->id]);

    $this->delete(route('witnesses.destroy', $witness));

    expect(LemmaReading::find($reading->id))->toBeNull()
        ->and(EditionLemma::find($editionLemma->id))->toBeNull()
        ->and(EditionPassage::find($editionPassage->id))->toBeNull();
});

test('a layer copied from one belonging to a deleted witness survives, with its provenance link cleared', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $original = TranscriptionLayer::factory()->for($witness)->create();

    $otherWitness = Witness::factory()->create();
    $fork = TranscriptionLayer::factory()->for($otherWitness)->create(['copied_from_id' => $original->id]);

    $this->delete(route('witnesses.destroy', $witness));

    $fork->refresh();
    expect(TranscriptionLayer::find($original->id))->toBeNull()
        ->and(TranscriptionLayer::find($fork->id))->not->toBeNull()
        ->and($fork->copied_from_id)->toBeNull();
});
