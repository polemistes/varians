<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
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
    //
    // Assignments, not passages: a passage is a citable line number, cheap to
    // recreate, while assigning a witness's words to it is the work. Two
    // witnesses citing the same passage is two assignments and one passage.
    $this->actingAs(User::factory()->editor()->create());

    $work = Work::factory()->create();
    Edition::factory()->for($work)->count(2)->create();
    $passage = CanonicalPassage::factory()->for($work)->create();

    foreach (range(1, 2) as $ignored) {
        TranscriptionSegment::factory()
            ->for(TranscriptionLayer::factory())
            ->for($passage, 'canonicalPassage')
            ->create();
    }

    $this->get(route('home'))->assertInertia(fn (AssertInertia $page) => $page
        ->where('works.0.editions_count', 2)
        ->where('works.0.transcription_segments_count', 2)
    );
});

test('every front-page row names its owner and when it was made, so copies are told apart', function () {
    // A copy keeps the original's title and siglum, so without the owner
    // and the date the lists show two identical rows (user report).
    $owner = User::factory()->create(['name' => 'Anna Lyt']);
    $work = Work::factory()->for($owner)->create(['title' => 'Lysistrata']);
    $edition = Edition::factory()->for($work)->for($owner)->create(['title' => 'Editio maior', 'visibility' => 'published']);
    $witness = Witness::factory()->for($owner)->create(['siglum' => 'A']);
    $layer = TranscriptionLayer::factory()->for($witness)->create(['text' => 'the quick fox']);
    $passage = CanonicalPassage::factory()->for($work)->create();
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 13]);
    $layer->transcription->update(['visibility' => 'published']);

    $copier = User::factory()->create(['name' => 'Bent Sen']);
    $this->actingAs($copier)->post(route('editions.copy', $edition))->assertRedirect();

    $this->get(route('home'))->assertInertia(function (AssertInertia $page) {
        // Two editions of the same title, told apart by owner.
        $editions = collect($page->toArray()['props']['editions'])->where('title', 'Editio maior');
        expect($editions)->toHaveCount(2)
            ->and($editions->pluck('user.name')->sort()->values()->all())->toBe(['Anna Lyt', 'Bent Sen'])
            ->and($editions->every(fn ($row) => filled($row['created_at'])))->toBeTrue();

        $witnesses = collect($page->toArray()['props']['witnesses'])->where('siglum', 'A');
        expect($witnesses->pluck('user.name')->sort()->values()->all())->toBe(['Anna Lyt', 'Bent Sen'])
            ->and($witnesses->every(fn ($row) => filled($row['created_at'])))->toBeTrue();

        $works = collect($page->toArray()['props']['works']);
        expect($works->every(fn ($row) => filled($row['created_at']) && filled($row['user']['name'])))->toBeTrue();
    });
});
