<?php

use App\Models\CanonicalPassage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use Inertia\Testing\AssertableInertia as AssertInertia;

test('a guest cannot see a work with no published transcription', function () {
    $this->actingAs(User::factory()->create());
    $work = Work::factory()->create();

    $indexResponse = $this->get(route('works.index'));
    $showResponse = $this->get(route('works.show', $work));

    $indexResponse->assertInertia(fn (AssertInertia $page) => $page->has('works', 0));
    $showResponse->assertForbidden();
});

test('a guest can see a work once one of its transcriptions is published', function () {
    $this->actingAs(User::factory()->create());
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $transcription = TranscriptionLayer::factory()->published()->create();
    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create();

    $indexResponse = $this->get(route('works.index'));
    $showResponse = $this->get(route('works.show', $work));

    $indexResponse->assertInertia(fn (AssertInertia $page) => $page->has('works', 1));
    $showResponse->assertOk();
});

test('an anonymous visitor cannot see a work with no published transcription', function () {
    $work = Work::factory()->create();

    $response = $this->get(route('works.show', $work));

    $response->assertForbidden();
});

test('an editor sees every work regardless of publication status', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();

    $indexResponse = $this->get(route('works.index'));
    $showResponse = $this->get(route('works.show', $work));

    $indexResponse->assertInertia(fn (AssertInertia $page) => $page->has('works', 1));
    $showResponse->assertOk();
});

test('a draft transcription on an otherwise-published work stays hidden from a guest', function () {
    $this->actingAs(User::factory()->create());
    $work = Work::factory()->create();
    $publishedPassage = CanonicalPassage::factory()->for($work)->create();
    $publishedTranscription = TranscriptionLayer::factory()->published()->create();
    TranscriptionSegment::factory()->for($publishedTranscription)->for($publishedPassage, 'canonicalPassage')->create();

    $draftPassage = CanonicalPassage::factory()->for($work)->create();
    $draftTranscription = TranscriptionLayer::factory()->create();
    TranscriptionSegment::factory()->for($draftTranscription)->for($draftPassage, 'canonicalPassage')->create();

    $response = $this->get(route('works.show', $work));

    $response->assertOk();
    $response->assertInertia(fn (AssertInertia $page) => $page->has('transcriptions', 1));
});
