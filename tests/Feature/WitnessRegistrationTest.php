<?php

use App\Enums\WitnessType;
use App\Models\User;
use App\Models\Witness;

test('a witness can be registered standalone, without any work', function () {
    $this->actingAs(User::factory()->editor()->create());

    $response = $this->post(route('witnesses.store'), [
        'type' => 'manuscript',
        'siglum' => 'B',
        'label' => 'Codex Clarkianus',
        'repository' => 'Bodleian Library',
        'shelfmark' => 'MS. E. D. Clarke 39',
        'date_text' => 'AD 895',
    ]);

    $witness = Witness::sole();
    $response->assertRedirect(route('witnesses.show', $witness));

    expect($witness->siglum)->toBe('B')
        ->and($witness->type)->toBe(WitnessType::Manuscript)
        ->and($witness->manuscript?->shelfmark)->toBe('MS. E. D. Clarke 39')
        ->and($witness->relatedWorks()->exists())->toBeFalse();
});

test('a printed edition witness registered standalone has no manuscript record', function () {
    $this->actingAs(User::factory()->editor()->create());

    $this->post(route('witnesses.store'), [
        'type' => 'printed_edition',
        'siglum' => 'OCT',
    ]);

    $witness = Witness::sole();

    expect($witness->manuscript)->toBeNull();
});
