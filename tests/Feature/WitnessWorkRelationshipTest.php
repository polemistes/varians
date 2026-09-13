<?php

use App\Models\Assignment;
use App\Models\CanonicalPassage;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use App\Models\Work;

test('a witness is unrelated to a work until one of its transcriptions assigns text to it', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create();

    expect($work->relatedWitnesses()->whereKey($witness->id)->exists())->toBeFalse()
        ->and($witness->relatedWorks()->whereKey($work->id)->exists())->toBeFalse();
});

test('a witness becomes related to a work once an assignment assigns text to one of its passages', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create();

    Assignment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create();

    expect($work->relatedWitnesses()->whereKey($witness->id)->exists())->toBeTrue()
        ->and($witness->relatedWorks()->whereKey($work->id)->exists())->toBeTrue();
});

test('a witness whose transcriptions assign no work is related to none', function () {
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->create();

    expect($witness->relatedWorks()->count())->toBe(0);
});

test('a witness whose one transcription assigns two works appears under both', function () {
    $firstWork = Work::factory()->create();
    $secondWork = Work::factory()->create();
    $witness = Witness::factory()->create();

    $firstPassage = CanonicalPassage::factory()->for($firstWork)->create();
    $secondPassage = CanonicalPassage::factory()->for($secondWork)->create();

    // One slot per layer is enough for a manuscript containing several works:
    // a TranscriptionLayer has no work_id, and its assignments point into whichever
    // works its text covers.
    $transcription = TranscriptionLayer::factory()->for($witness)->create();

    Assignment::factory()->for($transcription)->for($firstPassage, 'canonicalPassage')->create();
    Assignment::factory()->for($transcription)->for($secondPassage, 'canonicalPassage')->create();

    expect($witness->relatedWorks()->pluck('works.id')->all())
        ->toEqualCanonicalizing([$firstWork->id, $secondWork->id]);
});
