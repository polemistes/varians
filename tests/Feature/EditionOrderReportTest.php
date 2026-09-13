<?php

use App\Models\Assignment;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionSegment;
use App\Models\EditionTransposition;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;
use App\Support\Edition\SegmentOrderRewriter;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Adds $count segments (book 1, lines 1..$count) to the edition,
 * each backed by its own throwaway single-segment transcription — mirrors
 * EditionOrderTest's addSegmentsToEdition(). The
 * throwaways each assign one segment only, so they never contribute to the
 * order report (a source needs at least two).
 */
function editionForOrderReport(int $count): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();

    $segments = collect(range(1, $count))->map(function (int $line) use ($work, $edition) {
        $formatted = $work->referenceScheme->format(['book' => 1, 'line' => $line]);
        $segment = Segment::factory()->for($work)->create([
            'address' => ['book' => 1, 'line' => $line],
            'sort_key' => $formatted['sort_key'],
            'label' => $formatted['label'],
        ]);
        $transcription = TranscriptionLayer::factory()->create(['text' => 'word']);
        $assignment = Assignment::factory()->for($transcription)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 4]);
        SegmentAdder::add($edition, $assignment, (float) $line);

        return $segment;
    });

    return compact('work', 'edition', 'segments');
}

/**
 * A witness assigning text to the given segments in the given physical order, one
 * word each, space-separated.
 */
function witnessWithPhysicalOrder(array $segments): TranscriptionLayer
{
    $layer = TranscriptionLayer::factory()->create([
        'text' => implode(' ', array_fill(0, count($segments), 'word')),
    ]);

    foreach (array_values($segments) as $index => $segment) {
        Assignment::factory()->for($layer)->for($segment, 'segment')->create([
            'start_offset' => $index * 5,
            'end_offset' => $index * 5 + 4,
        ]);
    }

    return $layer;
}

test('a witness\'s block covers exactly where it differs from the printed order, through unrelated moves', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = editionForOrderReport(4);

    // Witness W physically has line 4 before line 3, disagreeing with the
    // printed 3-then-4 — a block of exactly those two lines.
    witnessWithPhysicalOrder([$segments[3], $segments[2]]);

    // The editor moves line 1 to the end: printed order 2, 3, 4, 1. W does
    // not assign lines 1 or 2, so nothing about that move concerns W.
    SegmentOrderRewriter::moveRange($edition, $segments[0]->id, null, $segments[3]->id, 'after');

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowSegments.0.label', $segments[1]->label)
        ->where('windowSegments.0.order_range', null)
        ->where('windowSegments.1.label', $segments[2]->label)
        ->where('windowSegments.1.order_range.range_label', "{$segments[2]->label}–{$segments[3]->label}")
        ->where('windowSegments.2.order_range.range_label', "{$segments[2]->label}–{$segments[3]->label}")
        ->where('windowSegments.3.label', $segments[0]->label)
        ->where('windowSegments.3.order_range', null));
});

test('independent blocks from one witness stay independent sites', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = editionForOrderReport(5);

    // W: 2, 1, 3, 5, 4 — two self-contained swaps with line 3 untouched
    // between them.
    witnessWithPhysicalOrder([$segments[1], $segments[0], $segments[2], $segments[4], $segments[3]]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowSegments.0.order_range.range_key', "{$segments[0]->id}-{$segments[1]->id}")
        ->where('windowSegments.1.order_range.range_key', "{$segments[0]->id}-{$segments[1]->id}")
        ->where('windowSegments.2.order_range', null)
        ->where('windowSegments.3.order_range.range_key', "{$segments[3]->id}-{$segments[4]->id}")
        ->where('windowSegments.4.order_range.range_key', "{$segments[3]->id}-{$segments[4]->id}"));
});

test('the block marker anchors on the first member in printed order, and members list the printed sequence', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = editionForOrderReport(3);

    witnessWithPhysicalOrder([$segments[2], $segments[1]]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowSegments.0.order_range', null)
        ->where('windowSegments.1.order_range.anchor', true)
        ->where('windowSegments.2.order_range.anchor', false)
        ->where('windowSegments.1.order_range.member_segment_ids', [$segments[1]->id, $segments[2]->id])
        ->where('windowSegments.1.order_range.current_sequence', [$segments[1]->label, $segments[2]->label]));
});

test('a catalogued reordering conjecture creates a site even where every witness follows numbering order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = editionForOrderReport(3);

    $conjecture = Conjecture::factory()->reordering()->create([
        'segment_id' => $segments[0]->id,
        'proposed_by' => 'Bergk',
    ]);
    ConjectureOrderingEntry::create(['conjecture_id' => $conjecture->id, 'segment_id' => $segments[1]->id, 'sequence' => 0]);
    ConjectureOrderingEntry::create(['conjecture_id' => $conjecture->id, 'segment_id' => $segments[0]->id, 'sequence' => 1]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowSegments.0.order_range.candidates', function ($candidates) use ($conjecture, $segments) {
            $proposal = collect($candidates)->firstWhere('conjecture_id', $conjecture->id);

            return $proposal !== null
                && $proposal['proposed_by'] === 'Bergk'
                && $proposal['sequence'] === [$segments[1]->label, $segments[0]->label]
                && $proposal['matches_current'] === false;
        })
        ->where('windowSegments.2.order_range', null));
});

test('applying a candidate to a block scattered by the editor permutes only its members, in place', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = editionForOrderReport(4);

    // W disagrees on lines 2–3 (has 3 before 2).
    $witness = witnessWithPhysicalOrder([$segments[2], $segments[1]]);

    // The editor scatters the block: line 4 moved between 2 and 3 —
    // printed order 1, 2, 4, 3.
    SegmentOrderRewriter::moveRange($edition, $segments[3]->id, null, $segments[1]->id, 'after');

    // Following W permutes 2 and 3 among the slots they occupy; line 4
    // stays exactly where the editor put it.
    $this->post(route('edition-order.apply', $edition), [
        'range_start_segment_id' => $segments[1]->id,
        'range_end_segment_id' => $segments[2]->id,
        'transcription_layer_id' => $witness->id,
    ])->assertRedirect();

    $stored = EditionSegment::where('edition_id', $edition->id)->orderBy('position')->pluck('segment_id')->all();
    expect($stored)->toBe([$segments[0]->id, $segments[2]->id, $segments[3]->id, $segments[1]->id]);
});

test('departing from numbering order raises no site — the line numbers already say it', function () {
    // User decision: the report concerns only disagreement between the
    // PRINTED order and a witness or catalogued proposal. Numbering order
    // is visible in the numbering and is nobody's claim about the text.
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = editionForOrderReport(3);

    // Move line 1 to the end: printed 2, 3, 1. No witness assigns two of
    // these lines and no proposal exists, so nothing disagrees with what
    // is printed — no site, however far from numbering order this is.
    SegmentOrderRewriter::moveRange($edition, $segments[0]->id, null, $segments[2]->id, 'after');

    $rearranged = $this->get(route('editions.show', [$work, $edition]));
    $rearranged->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowSegments.0.order_range', null)
        ->where('windowSegments.1.order_range', null)
        ->where('windowSegments.2.order_range', null)
        ->missing('numberingOrderStatus'));
});

test('a catalogued transposition conjecture is an order-report site and an applyable candidate', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = editionForOrderReport(3);

    // Catalogued but not applied: line 2 moved after line 3.
    $bentley = Conjecture::factory()->transposition()->create([
        'segment_id' => $segments[1]->id,
        'move_target_segment_id' => $segments[2]->id,
        'move_position' => 'after',
        'proposed_by' => 'Bentley',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowSegments.0.order_range', null)
        ->where('windowSegments.1.order_range.candidates', function ($candidates) use ($bentley, $segments) {
            $proposal = collect($candidates)->firstWhere('conjecture_id', $bentley->id);

            return $proposal !== null
                && $proposal['proposed_by'] === 'Bentley'
                && $proposal['sequence'] === [$segments[2]->label, $segments[1]->label]
                && $proposal['matches_current'] === false;
        }));

    // Following it projects the statement onto the block and records the
    // adoption, like any other candidate.
    $this->post(route('edition-order.apply', $edition), [
        'range_start_segment_id' => $segments[1]->id,
        'range_end_segment_id' => $segments[2]->id,
        'conjecture_id' => $bentley->id,
    ])->assertRedirect();

    $stored = EditionSegment::where('edition_id', $edition->id)->orderBy('position')->pluck('segment_id')->all();
    expect($stored)->toBe([$segments[0]->id, $segments[2]->id, $segments[1]->id])
        ->and(EditionTransposition::sole()->conjecture_id)->toBe($bentley->id);
});
