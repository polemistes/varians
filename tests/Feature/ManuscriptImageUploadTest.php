<?php

use App\Models\Manuscript;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

test('a manuscript image can be uploaded', function () {
    $this->actingAs(User::factory()->editor()->create());
    Storage::fake('public');

    $manuscript = Manuscript::factory()->create();
    $file = UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg');

    $response = $this->post(route('manuscript-images.store', $manuscript), [
        'folio_label' => '13r',
        'image' => $file,
    ]);

    $response->assertRedirect();

    $image = $manuscript->images()->sole();

    expect($image->manuscriptPage->label)->toBe('13r')
        ->and((float) $image->position)->toBe(1.0);

    Storage::disk('public')->assertExists($image->path);
});

test('uploaded images are appended after existing ones', function () {
    $this->actingAs(User::factory()->editor()->create());
    Storage::fake('public');

    $manuscript = Manuscript::factory()->create();
    $manuscript->images()->create([
        'manuscript_page_id' => $manuscript->pages()->create(['label' => '1r', 'position' => 1])->id,
        'path' => 'manuscript-images/existing.jpg',
        'position' => 5,
    ]);

    $this->post(route('manuscript-images.store', $manuscript), [
        'folio_label' => '1v',
        'image' => UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg'),
    ]);

    $newImage = $manuscript->images()->whereRelation('manuscriptPage', 'label', '1v')->sole();

    expect((float) $newImage->position)->toBe(6.0);
});

test('a non-image file is rejected', function () {
    $this->actingAs(User::factory()->editor()->create());
    Storage::fake('public');

    $manuscript = Manuscript::factory()->create();

    $response = $this->post(route('manuscript-images.store', $manuscript), [
        'folio_label' => '13r',
        'image' => UploadedFile::fake()->create('notes.txt', 10),
    ]);

    $response->assertInvalid(['image']);
});
