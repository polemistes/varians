<?php

use App\Models\Assignment;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionSegment;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\Witness;
use App\Models\Work;
use App\Support\DeletionImpact;

test('forWork counts segments, editions, lemmas, conjectures, and assignment assignments across any witness', function () {
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    Edition::factory()->for($work)->create();
    Lemma::factory()->for($segment, 'segment')->create();
    Conjecture::factory()->for($segment, 'segment')->create();

    // An assignment on a witness with no other tie to this work — the least
    // obvious part of the cascade, since it's not "owned" by the work.
    $otherWorkSegment = Segment::factory()->create();
    Assignment::factory()->for($segment, 'segment')->create();
    Assignment::factory()->for($otherWorkSegment, 'segment')->create();

    expect(DeletionImpact::forWork($work))->toBe([
        'segments' => 1,
        'editions' => 1,
        'assignments' => 1,
        'conjectures' => 1,
        'lemmas' => 1,
    ]);
});

test('forWitness counts every cascaded category, without double-counting a region matched by both its transcription and its image', function () {
    $witness = Witness::factory()->create();

    $images = ManuscriptImage::factory()->for($witness)->count(2)->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create();

    Assignment::factory()->for($transcription)->create();

    // Matches via both transcription_layer_id and manuscript_image_id — must
    // still count once, not twice.
    TranscriptionRegion::factory()
        ->for($transcription)
        ->for($images->first(), 'manuscriptImage')
        ->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    EditionSegment::factory()->create(['transcription_layer_id' => $transcription->id]);

    expect(DeletionImpact::forWitness($witness))->toBe([
        'transcriptions' => 1,
        'assignments' => 1,
        'regions' => 1,
        'images' => 2,
        'pages' => 2,
        'editionSelections' => 1,
        'editionSegments' => 1,
    ]);
});

test('forWitness on a bare witness reports zero everything', function () {
    $witness = Witness::factory()->create();

    expect(DeletionImpact::forWitness($witness))->toBe([
        'transcriptions' => 0,
        'assignments' => 0,
        'regions' => 0,
        'images' => 0,
        'pages' => 0,
        'editionSelections' => 0,
        'editionSegments' => 0,
    ]);
});

test('forTranscription counts assignments, regions, and edition impact scoped to that transcription', function () {
    $transcription = TranscriptionLayer::factory()->create();
    $otherTranscription = TranscriptionLayer::factory()->create();

    Assignment::factory()->for($transcription)->create();
    Assignment::factory()->for($otherTranscription)->create();
    TranscriptionRegion::factory()->for($transcription)->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    EditionSegment::factory()->create(['transcription_layer_id' => $transcription->id]);

    expect(DeletionImpact::forTranscription($transcription))->toBe([
        'assignments' => 1,
        'regions' => 1,
        'editionSelections' => 1,
        'editionSegments' => 1,
    ]);
});

test('forManuscriptImage counts features and regions, regardless of which transcription a region belongs to', function () {
    $image = ManuscriptImage::factory()->create();
    ManuscriptImageFeature::factory()->for($image, 'manuscriptImage')->create();

    $unrelatedTranscription = TranscriptionLayer::factory()->create();
    TranscriptionRegion::factory()->for($unrelatedTranscription)->for($image, 'manuscriptImage')->create();

    expect(DeletionImpact::forManuscriptImage($image))->toBe([
        'features' => 1,
        'regions' => 1,
    ]);
});
