<?php

use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\Tag;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use Illuminate\Support\Facades\DB;

test('deleting a witness cascades its manuscript, images, transcriptions, and their spans, and redirects to the index', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $manuscript = Manuscript::factory()->for($witness)->create();
    $image = ManuscriptImage::factory()->for($manuscript)->create();
    $feature = ManuscriptImageFeature::factory()->for($image, 'manuscriptImage')->create();
    $transcription = Transcription::factory()->for($witness)->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();
    $transcription->tags()->attach(Tag::factory()->create());

    $response = $this->delete(route('witnesses.destroy', $witness));

    $response->assertRedirect(route('witnesses.index'));
    expect(Witness::find($witness->id))->toBeNull()
        ->and(Manuscript::find($manuscript->id))->toBeNull()
        ->and(ManuscriptImage::find($image->id))->toBeNull()
        ->and(ManuscriptImageFeature::find($feature->id))->toBeNull()
        ->and(Transcription::find($transcription->id))->toBeNull()
        ->and(TranscriptionSegment::find($segment->id))->toBeNull()
        ->and(TranscriptionRegion::find($region->id))->toBeNull()
        ->and(DB::table('tag_transcription')->where('transcription_id', $transcription->id)->count())->toBe(0);
});

test('deleting a witness whose transcription feeds a published edition removes that edition\'s selection and edition-passage membership', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $transcription = Transcription::factory()->for($witness)->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    $editionLemma = EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    $editionPassage = EditionPassage::factory()->create(['transcription_id' => $transcription->id]);

    $this->delete(route('witnesses.destroy', $witness));

    expect(LemmaReading::find($reading->id))->toBeNull()
        ->and(EditionLemma::find($editionLemma->id))->toBeNull()
        ->and(EditionPassage::find($editionPassage->id))->toBeNull();
});

test('a transcription forked from one belonging to a deleted witness survives, with its provenance link cleared', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $original = Transcription::factory()->for($witness)->create();

    $otherWitness = Witness::factory()->create();
    $fork = Transcription::factory()->for($otherWitness)->create(['forked_from_id' => $original->id]);

    $this->delete(route('witnesses.destroy', $witness));

    $fork->refresh();
    expect(Transcription::find($original->id))->toBeNull()
        ->and(Transcription::find($fork->id))->not->toBeNull()
        ->and($fork->forked_from_id)->toBeNull();
});
