<?php

use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use Inertia\Testing\AssertableInertia as AssertInertia;

test('a guest cannot see a witness with no published transcription', function () {
    $this->actingAs(User::factory()->create());
    $witness = Witness::factory()->create();

    $homeResponse = $this->get(route('home'));
    $showResponse = $this->get(route('witnesses.show', $witness));

    $homeResponse->assertInertia(fn (AssertInertia $page) => $page->has('witnesses', 0));
    $showResponse->assertForbidden();
});

test('a guest can see a witness once one of its transcriptions is published', function () {
    $this->actingAs(User::factory()->create());
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->published()->create();

    $homeResponse = $this->get(route('home'));
    $showResponse = $this->get(route('witnesses.show', $witness));

    $homeResponse->assertInertia(fn (AssertInertia $page) => $page->has('witnesses', 1));
    $showResponse->assertOk();
});

test('an anonymous visitor cannot see a witness with no published transcription', function () {
    $witness = Witness::factory()->create();

    $response = $this->get(route('witnesses.show', $witness));

    $response->assertForbidden();
});

test('an editor sees every witness regardless of publication status', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();

    $response = $this->get(route('witnesses.show', $witness));

    $response->assertOk();
});

test('a draft transcription stays hidden from a guest on an otherwise-visible witness page', function () {
    $this->actingAs(User::factory()->create());
    $witness = Witness::factory()->create();
    // Two transcriptions of the manuscript, only one of them published.
    TranscriptionLayer::factory()->for($witness)->normalized()->published()->create();
    TranscriptionLayer::factory()->for($witness)->diplomatic()->create();

    $response = $this->get(route('witnesses.show', $witness));

    $response->assertOk();
    $response->assertInertia(fn (AssertInertia $page) => $page->has('transcriptions', 1));
});
