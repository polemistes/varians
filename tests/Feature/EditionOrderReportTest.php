<?php

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use App\Support\Edition\PassageOrderRewriter;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Adds $count canonical passages (book 1, lines 1..$count) to the edition,
 * each backed by its own throwaway single-passage transcription — mirrors
 * EditionOrderTest's addPassagesToEdition(). The
 * throwaways each cite one passage only, so they never contribute to the
 * order report (a source needs at least two).
 */
function editionForOrderReport(int $count): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();

    $passages = collect(range(1, $count))->map(function (int $line) use ($work, $edition) {
        $formatted = $work->referenceScheme->format(['book' => 1, 'line' => $line]);
        $passage = CanonicalPassage::factory()->for($work)->create([
            'address' => ['book' => 1, 'line' => $line],
            'sort_key' => $formatted['sort_key'],
            'label' => $formatted['label'],
        ]);
        $transcription = TranscriptionLayer::factory()->create(['text' => 'word']);
        $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 4]);
        PassageAdder::add($edition, $segment, (float) $line);

        return $passage;
    });

    return compact('work', 'edition', 'passages');
}

/**
 * A witness citing the given passages in the given physical order, one
 * word each, space-separated.
 */
function witnessWithPhysicalOrder(array $passages): TranscriptionLayer
{
    $layer = TranscriptionLayer::factory()->create([
        'text' => implode(' ', array_fill(0, count($passages), 'word')),
    ]);

    foreach (array_values($passages) as $index => $passage) {
        TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')->create([
            'start_offset' => $index * 5,
            'end_offset' => $index * 5 + 4,
        ]);
    }

    return $layer;
}

test('a witness\'s block covers exactly where it differs from the printed order, through unrelated moves', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrderReport(4);

    // Witness W physically has line 4 before line 3, disagreeing with the
    // printed 3-then-4 — a block of exactly those two lines.
    witnessWithPhysicalOrder([$passages[3], $passages[2]]);

    // The editor moves line 1 to the end: printed order 2, 3, 4, 1. W does
    // not cite lines 1 or 2, so nothing about that move concerns W.
    PassageOrderRewriter::moveRange($edition, $passages[0]->id, null, $passages[3]->id, 'after');

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $passages[1]->label)
        ->where('windowPassages.0.order_range', null)
        ->where('windowPassages.1.label', $passages[2]->label)
        ->where('windowPassages.1.order_range.range_label', "{$passages[2]->label}–{$passages[3]->label}")
        ->where('windowPassages.2.order_range.range_label', "{$passages[2]->label}–{$passages[3]->label}")
        ->where('windowPassages.3.label', $passages[0]->label)
        ->where('windowPassages.3.order_range', null));
});

test('independent blocks from one witness stay independent sites', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrderReport(5);

    // W: 2, 1, 3, 5, 4 — two self-contained swaps with line 3 untouched
    // between them.
    witnessWithPhysicalOrder([$passages[1], $passages[0], $passages[2], $passages[4], $passages[3]]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.order_range.range_key', "{$passages[0]->id}-{$passages[1]->id}")
        ->where('windowPassages.1.order_range.range_key', "{$passages[0]->id}-{$passages[1]->id}")
        ->where('windowPassages.2.order_range', null)
        ->where('windowPassages.3.order_range.range_key', "{$passages[3]->id}-{$passages[4]->id}")
        ->where('windowPassages.4.order_range.range_key', "{$passages[3]->id}-{$passages[4]->id}"));
});

test('the block marker anchors on the first member in printed order, and members list the printed sequence', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrderReport(3);

    witnessWithPhysicalOrder([$passages[2], $passages[1]]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.order_range', null)
        ->where('windowPassages.1.order_range.anchor', true)
        ->where('windowPassages.2.order_range.anchor', false)
        ->where('windowPassages.1.order_range.member_canonical_passage_ids', [$passages[1]->id, $passages[2]->id])
        ->where('windowPassages.1.order_range.current_sequence', [$passages[1]->label, $passages[2]->label]));
});

test('a catalogued reordering conjecture creates a site even where every witness follows citation order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrderReport(3);

    $conjecture = Conjecture::factory()->reordering()->create([
        'canonical_passage_id' => $passages[0]->id,
        'proposed_by' => 'Bergk',
    ]);
    ConjectureOrderingEntry::create(['conjecture_id' => $conjecture->id, 'canonical_passage_id' => $passages[1]->id, 'sequence' => 0]);
    ConjectureOrderingEntry::create(['conjecture_id' => $conjecture->id, 'canonical_passage_id' => $passages[0]->id, 'sequence' => 1]);

    $show = $this->get(route('editions.show', [$work, $edition]));

    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.order_range.candidates', function ($candidates) use ($conjecture, $passages) {
            $proposal = collect($candidates)->firstWhere('conjecture_id', $conjecture->id);

            return $proposal !== null
                && $proposal['proposed_by'] === 'Bergk'
                && $proposal['sequence'] === [$passages[1]->label, $passages[0]->label]
                && $proposal['matches_current'] === false;
        })
        ->where('windowPassages.2.order_range', null));
});

test('applying a candidate to a block scattered by the editor permutes only its members, in place', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrderReport(4);

    // W disagrees on lines 2–3 (has 3 before 2).
    $witness = witnessWithPhysicalOrder([$passages[2], $passages[1]]);

    // The editor scatters the block: line 4 moved between 2 and 3 —
    // printed order 1, 2, 4, 3.
    PassageOrderRewriter::moveRange($edition, $passages[3]->id, null, $passages[1]->id, 'after');

    // Following W permutes 2 and 3 among the slots they occupy; line 4
    // stays exactly where the editor put it.
    $this->post(route('edition-order.apply', $edition), [
        'range_start_canonical_passage_id' => $passages[1]->id,
        'range_end_canonical_passage_id' => $passages[2]->id,
        'transcription_layer_id' => $witness->id,
    ])->assertRedirect();

    $stored = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->pluck('canonical_passage_id')->all();
    expect($stored)->toBe([$passages[0]->id, $passages[2]->id, $passages[3]->id, $passages[1]->id]);
});

test('departing from citation order raises no site — the line numbers already say it', function () {
    // User decision: the report concerns only disagreement between the
    // PRINTED order and a witness or catalogued proposal. Citation order
    // is visible in the numbering and is nobody's claim about the text.
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrderReport(3);

    // Move line 1 to the end: printed 2, 3, 1. No witness cites two of
    // these lines and no proposal exists, so nothing disagrees with what
    // is printed — no site, however far from citation order this is.
    PassageOrderRewriter::moveRange($edition, $passages[0]->id, null, $passages[2]->id, 'after');

    $rearranged = $this->get(route('editions.show', [$work, $edition]));
    $rearranged->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.order_range', null)
        ->where('windowPassages.1.order_range', null)
        ->where('windowPassages.2.order_range', null)
        ->missing('citationOrderStatus'));
});

test('a catalogued transposition conjecture is an order-report site and an applyable candidate', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrderReport(3);

    // Catalogued but not applied: line 2 moved after line 3.
    $bentley = Conjecture::factory()->transposition()->create([
        'canonical_passage_id' => $passages[1]->id,
        'move_target_canonical_passage_id' => $passages[2]->id,
        'move_position' => 'after',
        'proposed_by' => 'Bentley',
    ]);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.order_range', null)
        ->where('windowPassages.1.order_range.candidates', function ($candidates) use ($bentley, $passages) {
            $proposal = collect($candidates)->firstWhere('conjecture_id', $bentley->id);

            return $proposal !== null
                && $proposal['proposed_by'] === 'Bentley'
                && $proposal['sequence'] === [$passages[2]->label, $passages[1]->label]
                && $proposal['matches_current'] === false;
        }));

    // Following it projects the statement onto the block and records the
    // adoption, like any other candidate.
    $this->post(route('edition-order.apply', $edition), [
        'range_start_canonical_passage_id' => $passages[1]->id,
        'range_end_canonical_passage_id' => $passages[2]->id,
        'conjecture_id' => $bentley->id,
    ])->assertRedirect();

    $stored = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->pluck('canonical_passage_id')->all();
    expect($stored)->toBe([$passages[0]->id, $passages[2]->id, $passages[1]->id])
        ->and(EditionTransposition::sole()->conjecture_id)->toBe($bentley->id);
});
