<?php

use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Inertia\Testing\AssertableInertia as AssertInertia;

test('the home page renders with counts of works and witnesses visible to an editor', function () {
    $this->actingAs(User::factory()->editor()->create());

    Work::factory()->count(2)->create();
    Witness::factory()->count(3)->create();

    $response = $this->get(route('home'));

    $response->assertInertia(fn (AssertInertia $page) => $page
        ->component('Home')
        ->where('workCount', 2)
        ->where('witnessCount', 3)
    );
});

test('an anonymous visitor only counts works and witnesses connected to published transcriptions', function () {
    Work::factory()->count(2)->create();
    Witness::factory()->count(3)->create();

    $response = $this->get(route('home'));

    $response->assertInertia(fn (AssertInertia $page) => $page
        ->component('Home')
        ->where('workCount', 0)
        ->where('witnessCount', 0)
    );
});
