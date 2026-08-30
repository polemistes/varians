<?php

use App\Enums\Visibility;
use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Http\UploadedFile;

function uploadedTextFile(string $content, string $name = 'text.txt'): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'txt');
    file_put_contents($path, $content);

    return new UploadedFile($path, $name, 'text/plain', null, true);
}

test('importing a file creates a transcription with its raw contents, without yet relating the witness to the work', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $witness = Witness::factory()->create(['siglum' => 'OCT']);

    $response = $this->post(route('text-imports.store', $work), [
        'witness_id' => $witness->id,
        'file' => uploadedTextFile("μῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος"),
    ]);

    $response->assertRedirect();

    // Importing raw text creates no citation spans, so the witness isn't yet
    // related to the work — that only happens once a segment cites it.
    expect($work->relatedWitnesses()->whereKey($witness->id)->exists())->toBeFalse();

    $transcription = Transcription::sole();
    expect($transcription->witness_id)->toBe($witness->id)
        ->and($transcription->text)->toBe("μῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος")
        ->and($transcription->segments)->toHaveCount(0)
        ->and($transcription->visibility)->toBe(Visibility::Draft);
});

test('importing preserves line breaks and any literal line numbers exactly as uploaded', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $witness = Witness::factory()->create();

    $content = "45 τὸν δ' ἀπαμειβόμενος προσέφη\n46 πόδας ὠκὺς Ἀχιλλεύς";

    $this->post(route('text-imports.store', $work), [
        'witness_id' => $witness->id,
        'file' => uploadedTextFile($content),
    ])->assertRedirect();

    expect(Transcription::sole()->text)->toBe($content);
});

test('importing requires a witness and a file', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $this->post(route('text-imports.store', $work), [])
        ->assertInvalid(['witness_id', 'file']);

    expect(Transcription::count())->toBe(0);
});

test('importing rejects an empty file', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $witness = Witness::factory()->create();

    $this->post(route('text-imports.store', $work), [
        'witness_id' => $witness->id,
        'file' => uploadedTextFile('   '),
    ])->assertInvalid(['file']);

    expect(Transcription::count())->toBe(0);
});

test('a guest cannot import a text', function () {
    $this->actingAs(User::factory()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $witness = Witness::factory()->create();

    $response = $this->post(route('text-imports.store', $work), [
        'witness_id' => $witness->id,
        'file' => uploadedTextFile('some text'),
    ]);

    $response->assertForbidden();
    expect(Transcription::count())->toBe(0);
});
