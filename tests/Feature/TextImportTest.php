<?php

use App\Enums\Visibility;
use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
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
        'layer' => 'normalized',
        'file' => uploadedTextFile("μῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος"),
    ]);

    $response->assertRedirect();

    // Importing raw text creates no citation spans, so the witness isn't yet
    // related to the work — that only happens once a segment cites it.
    expect($work->relatedWitnesses()->whereKey($witness->id)->exists())->toBeFalse();

    // The imported text is a normalized text — someone's edition of the work,
    // not a record of what this manuscript has — so it lands in that layer,
    // and the diplomatic one is created empty beside it.
    $transcription = Transcription::sole();
    $normalized = $transcription->normalized;

    expect($transcription->witness_id)->toBe($witness->id)
        ->and($normalized->text)->toBe("μῆνιν ἄειδε θεὰ\nΠηληϊάδεω Ἀχιλῆος")
        ->and($normalized->segments)->toHaveCount(0)
        ->and($transcription->visibility)->toBe(Visibility::Draft)
        ->and($transcription->diplomatic->text)->toBe('');
});

test('importing preserves line breaks and any literal line numbers exactly as uploaded', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $witness = Witness::factory()->create();

    $content = "45 τὸν δ' ἀπαμειβόμενος προσέφη\n46 πόδας ὠκὺς Ἀχιλλεύς";

    $this->post(route('text-imports.store', $work), [
        'witness_id' => $witness->id,
        'layer' => 'normalized',
        'file' => uploadedTextFile($content),
    ])->assertRedirect();

    expect(Transcription::sole()->normalized->text)->toBe($content);
});

test('importing requires a witness and a file', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $this->post(route('text-imports.store', $work), [])
        ->assertInvalid(['witness_id', 'file']);

    expect(TranscriptionLayer::count())->toBe(0);
});

test('importing rejects an empty file', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $witness = Witness::factory()->create();

    $this->post(route('text-imports.store', $work), [
        'witness_id' => $witness->id,
        'layer' => 'normalized',
        'file' => uploadedTextFile('   '),
    ])->assertInvalid(['file']);

    expect(TranscriptionLayer::count())->toBe(0);
});

test('a guest cannot import a text', function () {
    $this->actingAs(User::factory()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $witness = Witness::factory()->create();

    $response = $this->post(route('text-imports.store', $work), [
        'witness_id' => $witness->id,
        'layer' => 'normalized',
        'file' => uploadedTextFile('some text'),
    ]);

    $response->assertForbidden();
    expect(TranscriptionLayer::count())->toBe(0);
});
