<?php

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;

test('deleting a work cascades its passages, editions, lemmas, conjectures, and citation segments on any witness, and redirects to the index', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();
    $lemma = Lemma::factory()->for($passage, 'canonicalPassage')->create();
    $conjecture = Conjecture::factory()->for($passage, 'canonicalPassage')->create();

    // A witness with no other connection to this work, cited only via a
    // segment — the least obvious part of the cascade.
    $witness = Witness::factory()->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create();

    $response = $this->delete(route('works.destroy', $work));

    $response->assertRedirect(route('works.index'));
    expect(Work::find($work->id))->toBeNull()
        ->and(CanonicalPassage::find($passage->id))->toBeNull()
        ->and(Edition::find($edition->id))->toBeNull()
        ->and(Lemma::find($lemma->id))->toBeNull()
        ->and(Conjecture::find($conjecture->id))->toBeNull()
        ->and(TranscriptionSegment::find($segment->id))->toBeNull()
        ->and(TranscriptionLayer::find($transcription->id))->not->toBeNull()
        ->and(Witness::find($witness->id))->not->toBeNull();
});

test('a guest cannot delete a work', function () {
    $this->actingAs(User::factory()->create());
    $work = Work::factory()->create();

    $response = $this->delete(route('works.destroy', $work));

    $response->assertForbidden();
    expect(Work::find($work->id))->not->toBeNull();
});
