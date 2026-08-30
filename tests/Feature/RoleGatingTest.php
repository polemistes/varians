<?php

use App\Models\Manuscript;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\User;
use App\Models\Witness;
use Illuminate\Http\UploadedFile;

test('a guest cannot upload a manuscript image', function () {
    $this->actingAs(User::factory()->create());
    $manuscript = Manuscript::factory()->create();

    $response = $this->post(route('manuscript-images.store', $manuscript), [
        'folio_label' => '1r',
        'image' => UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg'),
    ]);

    $response->assertForbidden();
    expect($manuscript->images()->count())->toBe(0);
});

test('a guest cannot mark a manuscript image feature', function () {
    $this->actingAs(User::factory()->create());
    $image = ManuscriptImage::factory()->create();

    $response = $this->post(route('manuscript-image-features.store', $image), [
        'label' => 'Illustration',
        'x' => 0.1, 'y' => 0.1, 'width' => 0.1, 'height' => 0.1,
    ]);

    $response->assertForbidden();
});

test('a guest cannot remove a manuscript image feature', function () {
    $this->actingAs(User::factory()->create());
    $feature = ManuscriptImageFeature::factory()->create();

    $response = $this->delete(route('manuscript-image-features.destroy', $feature));

    $response->assertForbidden();
    expect(ManuscriptImageFeature::find($feature->id))->not->toBeNull();
});

test('a guest cannot align an image region to a transcription', function () {
    $this->actingAs(User::factory()->create());
    $transcription = Transcription::factory()->create(['text' => 'the quick fox']);
    $image = ManuscriptImage::factory()->create();

    $response = $this->post(route('transcription-regions.store', $transcription), [
        'manuscript_image_id' => $image->id,
        'text' => 'the',
        'start_offset' => 0,
        'end_offset' => 3,
        'x' => 0.1, 'y' => 0.1, 'width' => 0.1, 'height' => 0.1,
    ]);

    $response->assertForbidden();
});

test('a guest cannot remove an image region', function () {
    $this->actingAs(User::factory()->create());
    $region = TranscriptionRegion::factory()->create();

    $response = $this->delete(route('transcription-regions.destroy', $region));

    $response->assertForbidden();
    expect(TranscriptionRegion::find($region->id))->not->toBeNull();
});

test('a guest cannot delete a witness', function () {
    $this->actingAs(User::factory()->create());
    $witness = Witness::factory()->create();

    $response = $this->delete(route('witnesses.destroy', $witness));

    $response->assertForbidden();
    expect(Witness::find($witness->id))->not->toBeNull();
});

test('a guest cannot delete a transcription', function () {
    $this->actingAs(User::factory()->create());
    $transcription = Transcription::factory()->create();

    $response = $this->delete(route('transcriptions.destroy', $transcription));

    $response->assertForbidden();
    expect(Transcription::find($transcription->id))->not->toBeNull();
});

test('a guest cannot delete a manuscript image', function () {
    $this->actingAs(User::factory()->create());
    $image = ManuscriptImage::factory()->create();

    $response = $this->delete(route('manuscript-images.destroy', $image));

    $response->assertForbidden();
    expect(ManuscriptImage::find($image->id))->not->toBeNull();
});

test('an anonymous visitor is redirected to log in rather than 403ing on an editor-only route', function () {
    $response = $this->post(route('witnesses.store'), [
        'type' => 'printed_edition',
        'siglum' => 'OCT',
    ]);

    $response->assertRedirect(route('login'));
});
