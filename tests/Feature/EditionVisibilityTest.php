<?php

use App\Enums\Visibility;
use App\Models\Edition;
use App\Models\User;
use App\Models\Work;

test('anyone can view a published edition', function () {
    $edition = Edition::factory()->published()->create();

    $response = $this->get(route('editions.show', [$edition->work, $edition]));

    $response->assertOk();
});

test('a guest cannot view a draft edition', function () {
    $this->actingAs(User::factory()->create());
    $edition = Edition::factory()->create(['visibility' => Visibility::Draft]);

    $response = $this->get(route('editions.show', [$edition->work, $edition]));

    $response->assertForbidden();
});

test('an anonymous visitor cannot view a draft edition', function () {
    $edition = Edition::factory()->create(['visibility' => Visibility::Draft]);

    $response = $this->get(route('editions.show', [$edition->work, $edition]));

    $response->assertForbidden();
});

test('any editor can view a draft edition, not just its creator', function () {
    $creator = User::factory()->editor()->create();
    $viewer = User::factory()->editor()->create();
    $edition = Edition::factory()->for($creator, 'user')->create(['visibility' => Visibility::Draft]);
    $this->actingAs($viewer);

    $response = $this->get(route('editions.show', [$edition->work, $edition]));

    $response->assertOk();
});

test('viewing an edition under a work it does not belong to 404s', function () {
    $edition = Edition::factory()->published()->create();
    $unrelatedWork = Work::factory()->create();

    $response = $this->get(route('editions.show', [$unrelatedWork, $edition]));

    $response->assertNotFound();
});
