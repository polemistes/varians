<?php

use App\Models\CanonicalPassage;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\Witness;
use App\Models\Work;

test('a witness is unrelated to a work until one of its transcriptions cites it', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create();

    expect($work->relatedWitnesses()->whereKey($witness->id)->exists())->toBeFalse()
        ->and($witness->relatedWorks()->whereKey($work->id)->exists())->toBeFalse();
});

test('a witness becomes related to a work once a segment cites one of its passages', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $transcription = Transcription::factory()->for($witness)->create();

    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create();

    expect($work->relatedWitnesses()->whereKey($witness->id)->exists())->toBeTrue()
        ->and($witness->relatedWorks()->whereKey($work->id)->exists())->toBeTrue();
});

test('a witness whose transcriptions cite no work is related to none', function () {
    $witness = Witness::factory()->create();
    Transcription::factory()->for($witness)->create();

    expect($witness->relatedWorks()->count())->toBe(0);
});

test('a witness related to two works via different transcriptions appears under both', function () {
    $firstWork = Work::factory()->create();
    $secondWork = Work::factory()->create();
    $witness = Witness::factory()->create();

    $firstPassage = CanonicalPassage::factory()->for($firstWork)->create();
    $secondPassage = CanonicalPassage::factory()->for($secondWork)->create();

    $firstTranscription = Transcription::factory()->for($witness)->create();
    $secondTranscription = Transcription::factory()->for($witness)->create();

    TranscriptionSegment::factory()->for($firstTranscription)->for($firstPassage, 'canonicalPassage')->create();
    TranscriptionSegment::factory()->for($secondTranscription)->for($secondPassage, 'canonicalPassage')->create();

    expect($witness->relatedWorks()->pluck('works.id')->all())
        ->toEqualCanonicalizing([$firstWork->id, $secondWork->id]);
});
