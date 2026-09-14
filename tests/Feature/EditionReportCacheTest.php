<?php

use App\Enums\ConjectureType;
use App\Models\Assignment;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;
use App\Support\Edition\SegmentOrderRewriter;
use Illuminate\Support\Facades\DB;

/**
 * The order report and the split-line report are derived over the whole
 * edition and cached under a fingerprint of everything they read — see
 * EditionController::wholeEditionReports. These tests pin that a change
 * to any input is seen at once, and that an unchanged edition is served
 * from the cache.
 */

/**
 * An edition of $count lines based on witness A, with witness B assigning
 * the same lines in numbering order.
 *
 * @return array{work: Work, edition: Edition, segments: list<Segment>, a: TranscriptionLayer, b: TranscriptionLayer}
 */
function reportedEdition(int $count): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $text = implode(' ', array_fill(0, $count, 'word'));
    $a = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => $text]);
    $b = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => $text]);
    $segments = [];

    for ($line = 1; $line <= $count; $line++) {
        $formatted = $work->referenceScheme->format(['book' => 1, 'line' => $line]);
        $segments[] = $segment = Segment::factory()->for($work)->create([
            'address' => ['book' => 1, 'line' => $line],
            'sort_key' => $formatted['sort_key'],
            'label' => $formatted['label'],
        ]);
        $offset = ($line - 1) * 5;
        $assignment = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => $offset, 'end_offset' => $offset + 4]);
        Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => $offset, 'end_offset' => $offset + 4]);
        SegmentAdder::add($edition, $assignment, (float) $line);
    }

    return compact('work', 'edition', 'segments', 'a', 'b');
}

/** The order sites and split-line reports the page shows, by segment label. */
function reportsShown(Work $work, Edition $edition): array
{
    $segments = test()->get(route('editions.show', [$work, $edition]))->assertOk()
        ->viewData('page')['props']['windowSegments'];

    return [
        'order' => collect($segments)->filter(fn (array $s) => $s['order_range'] !== null)->pluck('label')->values()->all(),
        'split' => collect($segments)->filter(fn (array $s) => $s['discontinuous_witnesses'] !== [])->pluck('label')->values()->all(),
    ];
}

test('an unchanged edition is served its reports from the cache', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition] = reportedEdition(3);

    $queries = function () use ($work, $edition): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        test()->get(route('editions.show', [$work, $edition]))->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    };

    // The cold load computes the reports — the ordering conjectures are
    // read for the order report — and the warm one reads them back.
    expect($queries())->toBeGreaterThan($queries());
});

test('moving a line is seen at once: the order report follows the printed order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = reportedEdition(3);

    expect(reportsShown($work, $edition)['order'])->toBe([]);

    // Printed 2, 1, 3: both witnesses have 1 before 2.
    SegmentOrderRewriter::moveRange($edition, $segments[0]->id, null, $segments[1]->id, 'after');

    expect(reportsShown($work, $edition)['order'])->toBe(['1.2', '1.1']);
});

test('a witness assigning a line in a second place is seen at once', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments, 'b' => $b] = reportedEdition(3);

    expect(reportsShown($work, $edition)['split'])->toBe([]);

    // B now has part of line 1 after line 3 as well.
    $b->update(['text' => $b->text.' more']);
    Assignment::factory()->for($b)->for($segments[0], 'segment')->create(['start_offset' => 15, 'end_offset' => 19, 'part' => 2]);

    expect(reportsShown($work, $edition)['split'])->toBe(['1.1']);
});

test('a reordering conjecture registered later is seen at once', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments] = reportedEdition(3);

    expect(reportsShown($work, $edition)['order'])->toBe([]);

    $conjecture = Conjecture::factory()->for($segments[1], 'segment')->create(['type' => ConjectureType::Reordering, 'text' => null]);
    $conjecture->orderingEntries()->create(['segment_id' => $segments[2]->id, 'sequence' => 1, 'part' => 1]);
    $conjecture->orderingEntries()->create(['segment_id' => $segments[1]->id, 'sequence' => 2, 'part' => 1]);

    expect(reportsShown($work, $edition)['order'])->toBe(['1.2', '1.3']);
});

test('a word changed inside an assignment, moving no offset, is seen in the split-line statements', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'segments' => $segments, 'b' => $b] = reportedEdition(3);

    // B has line 1 in two places: "word" at the start and "tail" after line 3.
    $b->update(['text' => $b->text.' tail']);
    Assignment::factory()->for($b)->for($segments[0], 'segment')->create(['start_offset' => 15, 'end_offset' => 19, 'part' => 2]);

    $statement = fn (): string => implode(' ', collect(test()->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowSegments'][0]['discontinuous_witnesses'])
        ->flatMap(fn (array $witness) => $witness['statements'])->all());

    expect($statement())->toContain('"tail"');

    // Same length, same offsets — only the text hash can tell.
    $b->update(['text' => str_replace('tail', 'TAIL', $b->text)]);

    expect($statement())->toContain('"TAIL"');
});
