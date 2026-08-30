<?php

use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\User;
use App\Models\Witness;
use Inertia\Testing\AssertableInertia as AssertInertia;

test('a guest cannot see an image with no region on a published transcription, even on an otherwise-visible witness', function () {
    $this->actingAs(User::factory()->create());
    $witness = Witness::factory()->create();
    Transcription::factory()->for($witness)->published()->create();
    $manuscript = Manuscript::factory()->for($witness)->create();
    ManuscriptImage::factory()->for($manuscript)->create();

    $response = $this->get(route('witnesses.show', $witness));

    $response->assertOk();
    $response->assertInertia(fn (AssertInertia $page) => $page->has('witness.manuscript.images', 0));
});

test('a guest can see an image once it has a region on a published transcription', function () {
    $this->actingAs(User::factory()->create());
    $witness = Witness::factory()->create();
    $transcription = Transcription::factory()->for($witness)->published()->create();
    $manuscript = Manuscript::factory()->for($witness)->create();
    $image = ManuscriptImage::factory()->for($manuscript)->create();
    TranscriptionRegion::factory()->for($transcription)->for($image, 'manuscriptImage')->create();

    $response = $this->get(route('witnesses.show', $witness));

    $response->assertOk();
    $response->assertInertia(fn (AssertInertia $page) => $page->has('witness.manuscript.images', 1));
});

test('an image mapped only to a draft transcription stays hidden from a guest', function () {
    $this->actingAs(User::factory()->create());
    $witness = Witness::factory()->create();
    // A published transcription makes the witness page reachable...
    Transcription::factory()->for($witness)->published()->create();
    // ...but the image is only mapped to a separate, still-draft transcription.
    $draftTranscription = Transcription::factory()->for($witness)->create();
    $manuscript = Manuscript::factory()->for($witness)->create();
    $image = ManuscriptImage::factory()->for($manuscript)->create();
    TranscriptionRegion::factory()->for($draftTranscription)->for($image, 'manuscriptImage')->create();

    $response = $this->get(route('witnesses.show', $witness));

    $response->assertInertia(fn (AssertInertia $page) => $page->has('witness.manuscript.images', 0));
});

test('an editor sees every image regardless of publication status', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $manuscript = Manuscript::factory()->for($witness)->create();
    ManuscriptImage::factory()->for($manuscript)->create();

    $response = $this->get(route('witnesses.show', $witness));

    $response->assertOk();
    $response->assertInertia(fn (AssertInertia $page) => $page->has('witness.manuscript.images', 1));
});
