<?php

use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\SegmentAligner;

/**
 * A layer whose text for one segment is discontinuous — "the quick" assigned in
 * place, "fox" transposed to the head of the text — plus the work/scheme the
 * store route needs to resolve the label.
 *
 * @return array{work: Work, layer: TranscriptionLayer, segment: Segment}
 */
function splitAssignmentSetup(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    // "fox" (0..3) belongs at the END of the segment but stands first.
    $layer = TranscriptionLayer::factory()->create(['text' => "fox\nthe quick"]);
    $segment = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);

    $layer->assignments()->create([
        'segment_id' => $segment->id,
        'start_offset' => 4, 'end_offset' => 13, // "the quick"
        'part' => 1,
    ]);

    return ['work' => $work, 'layer' => $layer, 'segment' => $segment];
}

/** Each column's readings for one layer, resolved to words against its text. */
function layerColumnTexts(Segment $segment, TranscriptionLayer $layer): array
{
    return Lemma::where('segment_id', $segment->id)
        ->orderBy('position')
        ->with('readings')
        ->get()
        ->map(fn (Lemma $lemma) => $lemma->readings
            ->filter(fn (LemmaReading $reading) => $reading->transcription_layer_id === $layer->id)
            ->map(fn (LemmaReading $reading) => mb_substr($layer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset))
            ->values()->all())
        ->values()->all();
}

test('assigning text to a segment a second time in one layer adds another part, reading last by default', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'segment' => $segment] = splitAssignmentSetup();

    $response = $this->post(route('assignments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3, // "fox"
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();

    $parts = $layer->assignments()->where('segment_id', $segment->id)->inPartOrder()->get();
    expect($parts)->toHaveCount(2)
        ->and($parts[0]->start_offset)->toBe(4) // "the quick" still reads first
        ->and($parts[1]->start_offset)->toBe(0) // "fox" reads last despite standing first
        ->and($parts->pluck('part')->all())->toBe([1, 2]);
});

test('after_part inserts a part into the content order and renumbers the rest', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $layer = TranscriptionLayer::factory()->create(['text' => "fox\nthe quick"]);
    $segment = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);
    $first = $layer->assignments()->create(['segment_id' => $segment->id, 'start_offset' => 4, 'end_offset' => 7, 'part' => 1]); // "the"
    $second = $layer->assignments()->create(['segment_id' => $segment->id, 'start_offset' => 8, 'end_offset' => 13, 'part' => 2]); // "quick"

    $response = $this->post(route('assignments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3, // "fox", to read FIRST
        'work_id' => $work->id,
        'label' => '1.1',
        'after_part' => 0,
    ]);

    $response->assertRedirect();

    $parts = $layer->assignments()->where('segment_id', $segment->id)->inPartOrder()->get();
    expect($parts->pluck('start_offset')->all())->toBe([0, 4, 8])
        ->and($parts->pluck('part')->all())->toBe([1, 2, 3])
        ->and($first->fresh()->part)->toBe(2)
        ->and($second->fresh()->part)->toBe(3);
});

test('a late part on an already-collated segment is refused until acknowledged', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'segment' => $segment] = splitAssignmentSetup();
    SegmentAligner::alignWitness($segment, $layer->assignments()->get());

    $response = $this->post(route('assignments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertInvalid(['acknowledge_realignment']);
    expect($layer->assignments()->count())->toBe(1)
        ->and(SegmentAligner::layerReadings($segment, $layer))->toHaveCount(2); // untouched
});

test('an acknowledged late part re-collates the layer from all its parts', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'segment' => $segment] = splitAssignmentSetup();
    SegmentAligner::alignWitness($segment, $layer->assignments()->get());

    $response = $this->post(route('assignments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
        'acknowledge_realignment' => true,
    ]);

    $response->assertRedirect();
    $response->assertSessionHasNoErrors();

    // The apparatus now carries the segment's full text in content order —
    // the transposed "fox" included, after the words it follows in reading.
    expect(layerColumnTexts($segment, $layer))->toBe([['the'], ['quick'], ['fox']])
        ->and($layer->assignments()->where('segment_id', $segment->id)->count())->toBe(2);
});

test('a late part whose readings an edition selects keeps them and flags every part for review', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'segment' => $segment] = splitAssignmentSetup();
    SegmentAligner::alignWitness($segment, $layer->assignments()->get());

    $lemma = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings')->first();
    $selection = EditionLemma::create([
        'edition_id' => Edition::factory()->for($work)->create()->id,
        'lemma_id' => $lemma->id,
        'selected_reading_id' => $lemma->readings->first()->id,
    ]);
    $readingIdsBefore = SegmentAligner::layerReadings($segment, $layer)->pluck('id')->sort()->values()->all();

    $response = $this->post(route('assignments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
        'acknowledge_realignment' => true,
    ]);

    $response->assertRedirect();
    $response->assertSessionHasNoErrors();

    $parts = $layer->assignments()->where('segment_id', $segment->id)->get();
    expect($parts)->toHaveCount(2)
        ->and($parts->every(fn ($part) => $part->needs_review))->toBeTrue()
        // The edition's decision and the readings it rests on both survive.
        ->and(SegmentAligner::layerReadings($segment, $layer)->pluck('id')->sort()->values()->all())->toBe($readingIdsBefore)
        ->and(EditionLemma::whereKey($selection->id)->exists())->toBeTrue();
});

test('re-assigning text to an assignment into a segment its layer already assigns makes it a part of that segment', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'segment' => $segment] = splitAssignmentSetup();
    $other = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 2], 'sort_key' => '00000001.00000002', 'label' => '1.2',
    ]);
    $stray = $layer->assignments()->create(['segment_id' => $other->id, 'start_offset' => 0, 'end_offset' => 3, 'part' => 1]);

    $response = $this->patch(route('assignments.reassign', $stray), [
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();
    expect($stray->fresh()->segment_id)->toBe($segment->id)
        ->and($stray->fresh()->part)->toBe(2);
});
