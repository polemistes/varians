<?php

use App\Models\User;
use App\Models\Work;

test('an editor can correct a work\'s title and author', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create(['title' => 'Illiad', 'author' => 'Homerus']);

    $this->patch(route('works.update', $work), [
        'title' => 'Iliad',
        'author' => 'Homer',
    ])->assertRedirect();

    expect($work->fresh()->title)->toBe('Iliad')
        ->and($work->fresh()->author)->toBe('Homer');
});

test('the slug and reference scheme are not editable here', function () {
    // The slug is in the URL of every edition of this work, and every passage
    // address was built against the scheme; neither is a rename.
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create(['slug' => 'iliad']);
    $scheme = $work->reference_scheme_id;

    $this->patch(route('works.update', $work), [
        'title' => 'Iliad',
        'slug' => 'something-else',
        'reference_scheme_id' => 999,
    ])->assertRedirect();

    expect($work->fresh()->slug)->toBe('iliad')
        ->and($work->fresh()->reference_scheme_id)->toBe($scheme);
});

test('a title is required', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();

    $this->patch(route('works.update', $work), ['title' => ''])
        ->assertInvalid(['title']);
});

test('an author may be cleared', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create(['author' => 'Homer']);

    $this->patch(route('works.update', $work), ['title' => 'Iliad', 'author' => null]);

    expect($work->fresh()->author)->toBeNull();
});

test('a guest cannot rename a work', function () {
    $this->actingAs(User::factory()->create());
    $work = Work::factory()->create(['title' => 'Iliad']);

    $this->patch(route('works.update', $work), ['title' => 'Vandalised'])
        ->assertForbidden();

    expect($work->fresh()->title)->toBe('Iliad');
});
