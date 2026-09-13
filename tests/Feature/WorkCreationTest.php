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

test('any member can create a work, and owns it', function () {
    $member = User::factory()->create();
    $this->actingAs($member);
    $scheme = ReferenceScheme::factory()->create();

    $response = $this->post(route('works.store'), [
        'title' => 'Antigone',
        'language' => 'grc',
        'slug' => 'antigone',
        'reference_scheme_id' => $scheme->id,
    ]);

    $response->assertRedirect();
    expect(Work::where('slug', 'antigone')->sole()->user_id)->toBe($member->id);
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

test('a scheme may run a number level and a letter level together with no separator, named by word', function () {
    $this->actingAs(User::factory()->editor()->create());

    $this->post(route('works.store'), [
        'title' => 'Republic',
        'language' => 'grc',
        'slug' => 'republic',
        'new_scheme_name' => 'Stephanus',
        'levels' => [
            ['key' => 'page', 'label' => 'Page', 'type' => 'integer', 'separator' => 'none'],
            ['key' => 'section', 'label' => 'Section', 'type' => 'string', 'separator' => 'none'],
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => 'space'],
        ],
    ])->assertRedirect()->assertSessionHasNoErrors();

    $levels = Work::sole()->referenceScheme->levels;

    expect(array_column($levels, 'separator'))->toBe(['', '', ' '])
        ->and(Work::sole()->referenceScheme->parseLabel('327a 4'))->toBe(['page' => 327, 'section' => 'a', 'line' => 4]);
});

test('two levels of the same kind cannot run together without a separator', function () {
    $this->actingAs(User::factory()->editor()->create());

    $this->post(route('works.store'), [
        'title' => 'Antigone',
        'language' => 'grc',
        'slug' => 'antigone-2',
        'new_scheme_name' => 'Book and line',
        'levels' => [
            ['key' => 'book', 'label' => 'Book', 'type' => 'integer', 'separator' => 'none'],
            ['key' => 'line', 'label' => 'Line', 'type' => 'integer', 'separator' => 'none'],
        ],
    ])->assertSessionHasErrors('levels.1.separator');
});
