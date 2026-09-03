<?php

use App\Models\User;
use App\Models\Witness;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

test('a manuscript image can be uploaded', function () {
    $this->actingAs(User::factory()->editor()->create());
    Storage::fake('public');

    $witness = Witness::factory()->create();
    $file = UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg');

    $response = $this->post(route('manuscript-images.store', $witness), [
        'folio_label' => '13r',
        'image' => $file,
    ]);

    $response->assertRedirect();

    $image = $witness->images()->sole();

    expect($image->manuscriptPage->label)->toBe('13r')
        ->and((float) $image->position)->toBe(1.0);

    Storage::disk('public')->assertExists($image->path);
});

test('uploaded images are appended after existing ones', function () {
    $this->actingAs(User::factory()->editor()->create());
    Storage::fake('public');

    $witness = Witness::factory()->create();
    $witness->images()->create([
        'manuscript_page_id' => $witness->pages()->create(['label' => '1r', 'position' => 1])->id,
        'path' => 'manuscript-images/existing.jpg',
        'position' => 5,
    ]);

    $this->post(route('manuscript-images.store', $witness), [
        'folio_label' => '1v',
        'image' => UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg'),
    ]);

    $newImage = $witness->images()->whereRelation('manuscriptPage', 'label', '1v')->sole();

    expect((float) $newImage->position)->toBe(6.0);
});

test('a non-image file is rejected', function () {
    $this->actingAs(User::factory()->editor()->create());
    Storage::fake('public');

    $witness = Witness::factory()->create();

    $response = $this->post(route('manuscript-images.store', $witness), [
        'folio_label' => '13r',
        'image' => UploadedFile::fake()->create('notes.txt', 10),
    ]);

    $response->assertInvalid(['image']);
});

test('a page holds one photograph — a second upload to it is refused', function () {
    $this->actingAs(User::factory()->editor()->create());
    Storage::fake('public');

    $witness = Witness::factory()->create();
    $witness->images()->create([
        'manuscript_page_id' => $witness->pages()->create(['label' => '1r', 'position' => 1])->id,
        'path' => 'manuscript-images/existing.jpg',
        'position' => 1,
    ]);

    $this->post(route('manuscript-images.store', $witness), [
        'folio_label' => '1r',
        'image' => UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg'),
    ])->assertInvalid(['image']);

    expect($witness->images()->count())->toBe(1);
});
