<?php

use App\Models\User;
use App\Models\Witness;

test('a witness can be registered standalone, without any work', function () {
    $this->actingAs(User::factory()->editor()->create());

    $response = $this->post(route('witnesses.store'), [
        'siglum' => 'B',
        'label' => 'Codex Clarkianus',
        'repository' => 'Bodleian Library',
        'shelfmark' => 'MS. E. D. Clarke 39',
        'date_text' => 'AD 895',
        'description' => 'Copied for Arethas of Patras.',
    ]);

    $witness = Witness::sole();
    $response->assertRedirect(route('witnesses.show', $witness));

    expect($witness->siglum)->toBe('B')
        ->and($witness->shelfmark)->toBe('MS. E. D. Clarke 39')
        ->and($witness->description)->toBe('Copied for Arethas of Patras.')
        ->and($witness->relatedWorks()->exists())->toBeFalse();
});

test('a bare siglum is enough — every physical detail is optional', function () {
    $this->actingAs(User::factory()->editor()->create());

    // A collection of readings from the Suda has no shelfmark; there is no
    // witness "type" to choose, just fields left empty.
    $this->post(route('witnesses.store'), [
        'siglum' => 'OCT',
    ]);

    $witness = Witness::sole();

    expect($witness->shelfmark)->toBeNull()
        ->and($witness->repository)->toBeNull();
});

test('an editor can edit a witness after the fact', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create(['siglum' => 'R']);

    $this->patch(route('witnesses.update', $witness), [
        'date_text' => 's. XII',
        'description' => 'A late but careful copy.',
    ])->assertRedirect();

    expect($witness->fresh()->date_text)->toBe('s. XII')
        ->and($witness->fresh()->description)->toBe('A late but careful copy.')
        ->and($witness->fresh()->siglum)->toBe('R');
});

test('a guest cannot edit a witness', function () {
    $this->actingAs(User::factory()->create());

    $this->patch(route('witnesses.update', Witness::factory()->create()), [
        'siglum' => 'X',
    ])->assertForbidden();
});
