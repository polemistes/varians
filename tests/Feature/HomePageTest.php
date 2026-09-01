<?php

use App\Models\Edition;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * The front page is the whole site in three lists. It replaced separate works
 * and witnesses index pages that listed one category each while the front page
 * merely counted them.
 */
test('the front page lists the editions, works and witnesses an editor may see', function () {
    $this->actingAs(User::factory()->editor()->create());

    $work = Work::factory()->create();
    Edition::factory()->for($work)->count(2)->create();
    Work::factory()->create();
    Witness::factory()->count(3)->create();

    $this->get(route('home'))->assertInertia(fn (AssertInertia $page) => $page
        ->component('Home')
        ->has('editions', 2)
        ->has('works', 2)
        ->has('witnesses', 3)
    );
});

test('an anonymous visitor sees only what is published', function () {
    $work = Work::factory()->create();
    Edition::factory()->for($work)->count(2)->create();
    Witness::factory()->count(3)->create();

    $this->get(route('home'))->assertInertia(fn (AssertInertia $page) => $page
        ->component('Home')
        ->has('editions', 0)
        ->has('works', 0)
        ->has('witnesses', 0)
    );
});

test('an edition carries its work, since that is how it is reached', function () {
    $this->actingAs(User::factory()->editor()->create());

    $work = Work::factory()->create(['title' => 'Iliad']);
    Edition::factory()->for($work)->create(['title' => 'A working edition']);

    $this->get(route('home'))->assertInertia(fn (AssertInertia $page) => $page
        ->where('editions.0.title', 'A working edition')
        ->where('editions.0.work.title', 'Iliad')
        ->where('editions.0.work.slug', $work->slug)
    );
});

test('the counts a deletion warning needs come with the lists', function () {
    // Cheap withCount aggregates rather than a per-row DeletionImpact, which
    // would be a handful of queries for every item on the page.
    $this->actingAs(User::factory()->editor()->create());

    $work = Work::factory()->create();
    Edition::factory()->for($work)->count(2)->create();
    Witness::factory()->create();

    $this->get(route('home'))->assertInertia(fn (AssertInertia $page) => $page
        ->where('works.0.editions_count', 2)
        ->has('works.0.canonical_passages_count')
        ->where('witnesses.0.transcriptions_count', 0)
    );
});
