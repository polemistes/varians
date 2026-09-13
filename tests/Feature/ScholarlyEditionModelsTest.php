<?php

use App\Models\Assignment;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptPage;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Database\QueryException;

test('a work belongs to a reference scheme and has segments', function () {
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $segment = Segment::factory()->for($work)->create();

    expect($work->referenceScheme->is($scheme))->toBeTrue()
        ->and($work->segments->first()->is($segment))->toBeTrue();
});

test('a witness has ordered images', function () {
    $witness = Witness::factory()->create();
    ManuscriptImage::factory()->for($witness)
        ->for(ManuscriptPage::factory()->for($witness)->create(['label' => '2r']), 'manuscriptPage')
        ->create(['position' => 2]);
    ManuscriptImage::factory()->for($witness)
        ->for(ManuscriptPage::factory()->for($witness)->create(['label' => '1v']), 'manuscriptPage')
        ->create(['position' => 1]);

    expect($witness->images()->orderBy('position')->with('manuscriptPage')->get()
        ->map(fn ($image) => $image->manuscriptPage->label)->all())
        ->toBe(['1v', '2r']);
});

test('transcription assignment order can diverge from segment order', function () {
    $work = Work::factory()->create();
    $witness = Witness::factory()->create();

    $line976 = Segment::factory()->for($work)->create(['address' => ['line' => 976], 'sort_key' => '00000976', 'label' => '976']);
    $line1000 = Segment::factory()->for($work)->create(['address' => ['line' => 1000], 'sort_key' => '00001000', 'label' => '1000']);
    $line977 = Segment::factory()->for($work)->create(['address' => ['line' => 977], 'sort_key' => '00000977', 'label' => '977']);

    // In this witness, line 1000 physically appears between 976 and 977.
    $lines = ['nine seven six', 'one thousand', 'nine seven seven'];
    $transcription = TranscriptionLayer::factory()
        ->for($witness)
        ->for(User::factory(), 'user')
        ->create(['text' => implode("\n", $lines)]);

    $offset = 0;

    foreach ([$line976, $line1000, $line977] as $index => $segment) {
        $length = mb_strlen($lines[$index]);

        Assignment::factory()->for($transcription)->for($segment, 'segment')->create([
            'start_offset' => $offset,
            'end_offset' => $offset + $length,
        ]);

        $offset += $length + 1;
    }

    $physicalOrder = $transcription->assignments()->orderBy('start_offset')->with('segment')->get()
        ->map(fn (Assignment $assignment) => $assignment->segment->label)
        ->all();

    $numberingOrder = $work->segments()->orderBy('sort_key')->pluck('label')->all();

    expect($physicalOrder)->toBe(['976', '1000', '977'])
        ->and($numberingOrder)->toBe(['976', '977', '1000']);
});

test('a transcription layer can be copied', function () {
    $original = TranscriptionLayer::factory()->create();
    $fork = TranscriptionLayer::factory()->create(['copied_from_id' => $original->id]);

    expect($fork->copiedFrom->is($original))->toBeTrue()
        ->and($original->copies->first()->is($fork))->toBeTrue();
});

test('a transcription can have two separate spans assigning text to the same segment', function () {
    // e.g. a segment quoted twice, or split across a marginal interruption —
    // assignments are independent offset spans, not one-per-segment slots.
    $transcription = TranscriptionLayer::factory()->create();
    $segment = Segment::factory()->create();

    Assignment::factory()->for($transcription)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => 5]);
    Assignment::factory()->for($transcription)->for($segment, 'segment')
        ->create(['start_offset' => 10, 'end_offset' => 15]);

    expect($transcription->assignments()->where('segment_id', $segment->id)->count())->toBe(2);
});

test('an assignment always requires a segment', function () {
    Assignment::factory()->create(['segment_id' => null]);
})->throws(QueryException::class);
