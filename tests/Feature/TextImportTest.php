<?php

use App\Models\TranscriptionLayer;
use App\Models\User;
use Illuminate\Http\UploadedFile;

/**
 * Importing loads a file into one layer of a transcription that already
 * exists. It is not a way of starting a transcription, and it does not decide
 * which work the text belongs to — that follows from the citations assigned
 * to it afterwards.
 */
function uploadedTextFile(string $content, string $name = 'text.txt'): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'txt');
    file_put_contents($path, $content);

    return new UploadedFile($path, $name, 'text/plain', null, true);
}

test('a file loads into the layer it is given', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->normalized()->create(['text' => '']);

    $this->post(route('text-imports.store', $layer), [
        'file' => uploadedTextFile("μῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος"),
    ])->assertRedirect();

    expect($layer->fresh()->text)->toBe("μῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος")
        // Raw text carries no citations, so nothing is assigned to any work yet.
        ->and($layer->fresh()->segments)->toHaveCount(0);
});

test('either layer may be imported into', function () {
    // A file may as easily be a diplomatic transcript someone else typed as a
    // normalized edition of the work; the editor decides by opening one.
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->diplomatic()->create(['text' => '']);

    $this->post(route('text-imports.store', $layer), [
        'file' => uploadedTextFile('ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ'),
    ])->assertRedirect();

    expect($layer->fresh()->text)->toBe('ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ');
});

test('line breaks and any literal line numbers survive exactly as uploaded', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => '']);
    $content = "45 τὸν δ' ἀπαμειβόμενος προσέφη\n46 πόδας ὠκὺς Ἀχιλλεύς";

    $this->post(route('text-imports.store', $layer), [
        'file' => uploadedTextFile($content),
    ]);

    expect($layer->fresh()->text)->toBe($content);
});

test('importing over a layer that already has text is refused', function () {
    // Replacing it would leave every citation span, image region and page
    // division measured against words that are no longer there.
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => 'already here']);

    $this->post(route('text-imports.store', $layer), [
        'file' => uploadedTextFile('something else'),
    ])->assertInvalid(['file']);

    expect($layer->fresh()->text)->toBe('already here');
});

test('importing rejects an empty file', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => '']);

    $this->post(route('text-imports.store', $layer), [
        'file' => uploadedTextFile("   \n  "),
    ])->assertInvalid(['file']);
});

test('a guest cannot import a text', function () {
    $this->actingAs(User::factory()->create());
    $layer = TranscriptionLayer::factory()->create(['text' => '']);

    $this->post(route('text-imports.store', $layer), [
        'file' => uploadedTextFile('anything'),
    ])->assertForbidden();

    expect($layer->fresh()->text)->toBe('');
});
