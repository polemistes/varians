<?php

use App\Models\Edition;
use App\Models\User;
use App\Models\Work;

test('an editor can create an edition for a work', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();

    $response = $this->post(route('editions.store', $work), [
        'title' => 'Editio maior',
        'description' => 'A fuller critical text.',
    ]);

    $response->assertRedirect();

    $edition = Edition::sole();
    expect($edition->work_id)->toBe($work->id)
        ->and($edition->title)->toBe('Editio maior')
        ->and($edition->description)->toBe('A fuller critical text.')
        ->and($edition->visibility->value)->toBe('draft');
});

test('an edition title is required', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();

    $response = $this->post(route('editions.store', $work), []);

    $response->assertInvalid(['title']);
    expect(Edition::count())->toBe(0);
});

test('an edition title must be unique within its work, but not across works', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $otherWork = Work::factory()->create();
    Edition::factory()->for($work)->create(['title' => 'Editio maior']);

    $this->post(route('editions.store', $work), ['title' => 'Editio maior'])
        ->assertInvalid(['title']);

    $this->post(route('editions.store', $otherWork), ['title' => 'Editio maior'])
        ->assertRedirect();

    expect(Edition::where('title', 'Editio maior')->count())->toBe(2);
});

test('a guest cannot create an edition', function () {
    $this->actingAs(User::factory()->create());
    $work = Work::factory()->create();

    $response = $this->post(route('editions.store', $work), ['title' => 'Editio maior']);

    $response->assertForbidden();
    expect(Edition::count())->toBe(0);
});

test('an editor can delete an edition', function () {
    $this->actingAs(User::factory()->editor()->create());
    $edition = Edition::factory()->create();

    $response = $this->delete(route('editions.destroy', $edition));

    $response->assertRedirect();
    expect(Edition::find($edition->id))->toBeNull();
});
