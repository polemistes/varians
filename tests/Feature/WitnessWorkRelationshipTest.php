<?php

use App\Models\Assignment;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use App\Models\Work;

test('a witness is unrelated to a work until one of its transcriptions assigns text to it', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create();

    expect($work->relatedWitnesses()->whereKey($witness->id)->exists())->toBeFalse()
        ->and($witness->relatedWorks()->whereKey($work->id)->exists())->toBeFalse();
});

test('a witness becomes related to a work once an assignment assigns text to one of its segments', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $transcription = TranscriptionLayer::factory()->for($witness)->create();

    Assignment::factory()->for($transcription)->for($segment, 'segment')->create();

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

    $firstSegment = Segment::factory()->for($firstWork)->create();
    $secondSegment = Segment::factory()->for($secondWork)->create();

    // One slot per layer is enough for a manuscript containing several works:
    // a TranscriptionLayer has no work_id, and its assignments point into whichever
    // works its text covers.
    $transcription = TranscriptionLayer::factory()->for($witness)->create();

    Assignment::factory()->for($transcription)->for($firstSegment, 'segment')->create();
    Assignment::factory()->for($transcription)->for($secondSegment, 'segment')->create();

    expect($witness->relatedWorks()->pluck('works.id')->all())
        ->toEqualCanonicalizing([$firstWork->id, $secondWork->id]);
});
