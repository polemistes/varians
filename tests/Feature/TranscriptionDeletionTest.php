<?php

use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\Tag;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use Illuminate\Support\Facades\DB;

test('deleting a transcription cascades its segments, regions, and tags, redirects to its witness, and leaves the witness untouched', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $manuscript = Manuscript::factory()->for($witness)->create();
    $image = ManuscriptImage::factory()->for($manuscript)->create();
    $transcription = Transcription::factory()->for($witness)->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->create();
    $region = TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();
    $transcription->tags()->attach(Tag::factory()->create());

    $response = $this->delete(route('transcriptions.destroy', $transcription));

    $response->assertRedirect(route('witnesses.show', $witness));
    expect(Transcription::find($transcription->id))->toBeNull()
        ->and(TranscriptionSegment::find($segment->id))->toBeNull()
        ->and(TranscriptionRegion::find($region->id))->toBeNull()
        ->and(DB::table('tag_transcription')->where('transcription_id', $transcription->id)->count())->toBe(0)
        ->and(Witness::find($witness->id))->not->toBeNull()
        ->and(ManuscriptImage::find($image->id))->not->toBeNull();
});

test('a fork of a deleted transcription survives, with its provenance link cleared', function () {
    $this->actingAs(User::factory()->editor()->create());
    $original = Transcription::factory()->create();
    $fork = Transcription::factory()->create(['forked_from_id' => $original->id]);

    $this->delete(route('transcriptions.destroy', $original));

    $fork->refresh();
    expect(Transcription::find($original->id))->toBeNull()
        ->and($fork->forked_from_id)->toBeNull();
});

test('deleting a transcription that feeds a published edition removes that edition\'s selection and edition-passage membership', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create();

    $lemma = Lemma::factory()->create();
    $reading = LemmaReading::factory()->for($lemma)->for($transcription)->create();
    $editionLemma = EditionLemma::factory()->create(['lemma_id' => $lemma->id, 'selected_reading_id' => $reading->id]);
    $editionPassage = EditionPassage::factory()->create(['transcription_id' => $transcription->id]);

    $this->delete(route('transcriptions.destroy', $transcription));

    expect(LemmaReading::find($reading->id))->toBeNull()
        ->and(EditionLemma::find($editionLemma->id))->toBeNull()
        ->and(EditionPassage::find($editionPassage->id))->toBeNull();
});
