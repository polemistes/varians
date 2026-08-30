<?php

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\Witness;
use App\Models\Work;
use App\Support\DeletionImpact;

test('forWork counts passages, editions, lemmas, conjectures, and citation segments across any witness', function () {
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    Edition::factory()->for($work)->create();
    Lemma::factory()->for($passage, 'canonicalPassage')->create();
    Conjecture::factory()->for($passage, 'canonicalPassage')->create();

    // A segment on a witness with no other tie to this work — the least
    // obvious part of the cascade, since it's not "owned" by the work.
    $otherWorkPassage = CanonicalPassage::factory()->create();
    TranscriptionSegment::factory()->for($passage, 'canonicalPassage')->create();
    TranscriptionSegment::factory()->for($otherWorkPassage, 'canonicalPassage')->create();

    expect(DeletionImpact::forWork($work))->toBe([
        'canonicalPassages' => 1,
        'editions' => 1,
        'segments' => 1,
        'conjectures' => 1,
        'lemmas' => 1,
    ]);
});

test('forWitness counts every cascaded category, without double-counting a region matched by both its transcription and its image', function () {
    $witness = Witness::factory()->create();
    $manuscript = Manuscript::factory()->for($witness)->create();
    $images = ManuscriptImage::factory()->for($manuscript)->count(2)->create();
    $transcription = Transcription::factory()->for($witness)->create();

    TranscriptionSegment::factory()->for($transcription)->create();

    // Matches via both transcription_id and manuscript_image_id — must
    // still count once, not twice.
    TranscriptionRegion::factory()
        ->for($transcription)
        ->for($images->first(), 'manuscriptImage')
        ->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    EditionPassage::factory()->create(['transcription_id' => $transcription->id]);

    expect(DeletionImpact::forWitness($witness))->toBe([
        'transcriptions' => 1,
        'segments' => 1,
        'regions' => 1,
        'images' => 2,
        'editionSelections' => 1,
        'editionPassages' => 1,
    ]);
});

test('forWitness on a witness with no manuscript reports zero images and regions', function () {
    $witness = Witness::factory()->create(['type' => 'printed_edition']);

    expect(DeletionImpact::forWitness($witness))->toBe([
        'transcriptions' => 0,
        'segments' => 0,
        'regions' => 0,
        'images' => 0,
        'editionSelections' => 0,
        'editionPassages' => 0,
    ]);
});

test('forTranscription counts segments, regions, and edition impact scoped to that transcription', function () {
    $transcription = Transcription::factory()->create();
    $otherTranscription = Transcription::factory()->create();

    TranscriptionSegment::factory()->for($transcription)->create();
    TranscriptionSegment::factory()->for($otherTranscription)->create();
    TranscriptionRegion::factory()->for($transcription)->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    EditionPassage::factory()->create(['transcription_id' => $transcription->id]);

    expect(DeletionImpact::forTranscription($transcription))->toBe([
        'segments' => 1,
        'regions' => 1,
        'editionSelections' => 1,
        'editionPassages' => 1,
    ]);
});

test('forManuscriptImage counts features and regions, regardless of which transcription a region belongs to', function () {
    $image = ManuscriptImage::factory()->create();
    ManuscriptImageFeature::factory()->for($image, 'manuscriptImage')->create();

    $unrelatedTranscription = Transcription::factory()->create();
    TranscriptionRegion::factory()->for($unrelatedTranscription)->for($image, 'manuscriptImage')->create();

    expect(DeletionImpact::forManuscriptImage($image))->toBe([
        'features' => 1,
        'regions' => 1,
    ]);
});
