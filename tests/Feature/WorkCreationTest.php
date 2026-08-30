<?php

use App\Models\ReferenceScheme;
use App\Models\User;
use App\Models\Work;

test('a work can be created with an existing reference scheme', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();

    $response = $this->post(route('works.store'), [
        'title' => 'Odyssey',
        'author' => 'Homer',
        'language' => 'grc',
        'slug' => 'odyssey',
        'reference_scheme_id' => $scheme->id,
    ]);

    $response->assertRedirect();

    $work = Work::sole();

    expect($work->title)->toBe('Odyssey')
        ->and($work->reference_scheme_id)->toBe($scheme->id);
});

test('a work can be created with a newly defined reference scheme', function () {
    $this->actingAs(User::factory()->editor()->create());

    $response = $this->post(route('works.store'), [
        'title' => 'Antigone',
        'author' => 'Sophocles',
        'language' => 'grc',
        'slug' => 'antigone',
        'new_scheme_name' => 'Line numbering',
        'levels' => [
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => ''],
        ],
    ]);

    $response->assertRedirect();

    $work = Work::sole();

    expect($work->referenceScheme->name)->toBe('Line numbering')
        ->and($work->referenceScheme->levels)->toHaveCount(1);
});

test('a work requires either an existing or a new reference scheme', function () {
    $this->actingAs(User::factory()->editor()->create());

    $response = $this->post(route('works.store'), [
        'title' => 'Antigone',
        'language' => 'grc',
        'slug' => 'antigone',
    ]);

    $response->assertInvalid(['new_scheme_name', 'levels']);
});

test('a work slug must be unique', function () {
    $this->actingAs(User::factory()->editor()->create());
    Work::factory()->create(['slug' => 'iliad']);
    $scheme = ReferenceScheme::factory()->create();

    $response = $this->post(route('works.store'), [
        'title' => 'Iliad (duplicate)',
        'language' => 'grc',
        'slug' => 'iliad',
        'reference_scheme_id' => $scheme->id,
    ]);

    $response->assertInvalid(['slug']);
});

test('a guest cannot create a work', function () {
    $this->actingAs(User::factory()->create());

    $response = $this->post(route('works.store'), [
        'title' => 'Antigone',
        'language' => 'grc',
        'slug' => 'antigone',
    ]);

    $response->assertForbidden();
    expect(Work::count())->toBe(0);
});

test('an anonymous visitor is redirected to log in when trying to create a work', function () {
    $response = $this->post(route('works.store'), [
        'title' => 'Antigone',
        'language' => 'grc',
        'slug' => 'antigone',
    ]);

    $response->assertRedirect(route('login'));
    expect(Work::count())->toBe(0);
});
