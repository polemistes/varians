<?php

use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\SegmentAligner;

/**
 * A layer that stops assigning a segment's words must stop being collated
 * on them: its readings were read from those very words. Removing a span or
 * re-assigning it to another segment used to leave the readings behind, and
 * the witness stayed in the segment's apparatus (real bug).
 */
function collatedLayer(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $layer = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $segment = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);
    $assignment = $layer->assignments()->create([
        'segment_id' => $segment->id, 'start_offset' => 0, 'end_offset' => 13, 'part' => 1,
    ]);
    SegmentAligner::alignWitness($segment, $layer->assignments()->get());

    return [$work, $layer, $segment, $assignment];
}

test('removing a span removes the layer\'s readings on its segment', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $layer, $segment, $assignment] = collatedLayer();
    expect(SegmentAligner::layerReadings($segment, $layer))->toHaveCount(3);

    $this->delete(route('assignments.destroy', $assignment))->assertRedirect();

    expect($layer->assignments()->count())->toBe(0)
        ->and(SegmentAligner::layerReadings($segment, $layer))->toHaveCount(0);
});

test('removing one part re-collates the segment from the parts that remain', function () {
    $this->actingAs(User::factory()->editor()->create());
    [, $layer, $segment, $assignment] = collatedLayer();
    // Two parts: "the quick" and "fox".
    $assignment->update(['end_offset' => 9]);
    $tail = $layer->assignments()->create([
        'segment_id' => $segment->id, 'start_offset' => 10, 'end_offset' => 13, 'part' => 2,
    ]);

    $this->delete(route('assignments.destroy', $tail))->assertRedirect();

    $words = SegmentAligner::layerReadings($segment, $layer)
        ->map(fn ($reading) => mb_substr($layer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset))
        ->sort()->values()->all();

    expect($words)->toBe(['quick', 'the']);
});

test('readings an edition selects survive the span\'s removal, flagged for review', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$work, $layer, $segment, $assignment] = collatedLayer();
    $reading = SegmentAligner::layerReadings($segment, $layer)->first();
    $selection = EditionLemma::create([
        'edition_id' => Edition::factory()->for($work)->create()->id,
        'lemma_id' => $reading->lemma_id,
        'selected_reading_id' => $reading->id,
    ]);

    $this->delete(route('assignments.destroy', $assignment))->assertRedirect();

    expect(EditionLemma::whereKey($selection->id)->exists())->toBeTrue()
        ->and($reading->fresh()->needs_review)->toBeTrue()
        ->and(SegmentAligner::layerReadings($segment, $layer)->every(fn ($reading) => $reading->needs_review))->toBeTrue();
});

test('re-assigning a span to another segment removes the layer\'s readings on the one it left', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$work, $layer, $segment, $assignment] = collatedLayer();

    $this->patch(route('assignments.reassign', $assignment), [
        'work_id' => $work->id,
        'label' => '1.2',
    ])->assertRedirect()->assertSessionHasNoErrors();

    expect($assignment->fresh()->segment->label)->toBe('1.2')
        ->and(SegmentAligner::layerReadings($segment, $layer))->toHaveCount(0);
});

test('removing an ungrouped span never takes another ungrouped span with it', function () {
    // A row with no group has no counterpart. Looking one up by
    // `where('group_id', null)` matched every other ungrouped row of the
    // layer, and deleting one part deleted its neighbour (real bug).
    $this->actingAs(User::factory()->editor()->create());
    [, $layer, $segment, $assignment] = collatedLayer();
    $assignment->update(['end_offset' => 9]);
    $tail = $layer->assignments()->create([
        'segment_id' => $segment->id, 'start_offset' => 10, 'end_offset' => 13, 'part' => 2,
    ]);

    $this->delete(route('assignments.destroy', $tail))->assertRedirect();

    expect($layer->assignments()->sole()->is($assignment))->toBeTrue();
});
