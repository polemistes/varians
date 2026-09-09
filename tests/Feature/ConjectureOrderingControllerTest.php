<?php

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Adds $count canonical passages (book 1, lines 1..$count) to the edition,
 * each backed by its own throwaway transcription/segment — mirrors
 * EditionOrderTest's addPassagesToEdition().
 */
function editionForOrdering(int $count): array
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

test('authoring a new reordering conjecture creates it, its entries, and selects it for the edition in one step', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrdering(3);

    $response = $this->post(route('conjecture-orderings.store', $edition), [
        'canonical_passage_ids' => [$passages[2]->id, $passages[0]->id, $passages[1]->id],
        'proposed_by' => 'Bergk',
    ]);

    $response->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->type)->toBe(ConjectureType::Reordering)
        ->and($conjecture->proposed_by)->toBe('Bergk')
        ->and($conjecture->canonical_passage_id)->toBe($passages[0]->id) // first by citation order
        ->and($conjecture->orderingEntries->pluck('canonical_passage_id')->all())->toBe([$passages[2]->id, $passages[0]->id, $passages[1]->id]);

    // Applying rewrote the stored positions, and the application itself is
    // recorded as attribution (EditionTransposition — a Reordering is a
    // Conjecture like a Transposition is).
    $adoption = EditionTransposition::sole();
    expect($adoption->edition_id)->toBe($edition->id)
        ->and($adoption->conjecture_id)->toBe($conjecture->id);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $passages[2]->label)
        ->where('windowPassages.1.label', $passages[0]->label)
        ->where('windowPassages.2.label', $passages[1]->label));
});

test('a proposal recorded without following is catalogued as a candidate and leaves the order alone', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrdering(3);

    $this->post(route('conjecture-orderings.store', $edition), [
        'canonical_passage_ids' => [$passages[2]->id, $passages[0]->id, $passages[1]->id],
        'proposed_by' => 'Bergk',
        'follow' => false,
    ])->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->orderingEntries->pluck('canonical_passage_id')->all())
        ->toBe([$passages[2]->id, $passages[0]->id, $passages[1]->id])
        ->and(EditionTransposition::count())->toBe(0);

    // Printed order untouched; the proposal shows up as a disagreeing
    // candidate the editor may still follow.
    $this->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->where('windowPassages.0.label', $passages[0]->label)
            ->where('windowPassages.1.label', $passages[1]->label)
            ->where('windowPassages.2.label', $passages[2]->label)
            ->where('windowPassages.0.order_range.candidates', fn ($candidates) => collect($candidates)
                ->contains(fn (array $candidate) => $candidate['conjecture_id'] === $conjecture->id
                    && $candidate['matches_current'] === false)));
});

test('the submitted passages must form one contiguous range, nothing left out', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passages' => $passages] = editionForOrdering(3);

    // Leaves out the middle passage — not a contiguous range.
    $response = $this->post(route('conjecture-orderings.store', $edition), [
        'canonical_passage_ids' => [$passages[2]->id, $passages[0]->id],
    ]);

    $response->assertInvalid(['canonical_passage_ids']);
    expect(Conjecture::count())->toBe(0);
});

test('at least two passages are required', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passages' => $passages] = editionForOrdering(2);

    $response = $this->post(route('conjecture-orderings.store', $edition), [
        'canonical_passage_ids' => [$passages[0]->id],
    ]);

    $response->assertInvalid(['canonical_passage_ids']);
});

test('a guest cannot author a reordering conjecture', function () {
    $this->actingAs(User::factory()->create());
    ['edition' => $edition, 'passages' => $passages] = editionForOrdering(2);

    $this->post(route('conjecture-orderings.store', $edition), [
        'canonical_passage_ids' => [$passages[1]->id, $passages[0]->id],
    ])->assertForbidden();

    expect(Conjecture::count())->toBe(0);
});

test('an arrangement that divides a line is registered as pieces and reported like a witness\'s split citation', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionForOrdering(2);

    // The editor cut the tail of line 1 and pasted it after line 2.
    $this->post(route('conjecture-orderings.store', $edition), [
        'pieces' => [
            ['canonical_passage_id' => $passages[0]->id, 'part' => 1, 'text' => 'the quick'],
            ['canonical_passage_id' => $passages[1]->id, 'part' => 1, 'text' => 'line two'],
            ['canonical_passage_id' => $passages[0]->id, 'part' => 2, 'text' => 'fox'],
        ],
        'proposed_by' => 'Bentley',
        'follow' => false,
    ])->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->orderingEntries->map(fn ($entry) => [$entry->canonical_passage_id, $entry->part, $entry->text])->all())
        ->toBe([[$passages[0]->id, 1, 'the quick'], [$passages[1]->id, 1, 'line two'], [$passages[0]->id, 2, 'fox']]);

    $shown = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'];
    $report = $shown[0]['discontinuous_witnesses'];

    expect($report)->toHaveCount(1)
        ->and($report[0]['siglum'])->toBe('Bentley (conjecture)')
        ->and($report[0]['conjecture_id'])->toBe($conjecture->id)
        ->and($report[0]['matches_current'])->toBeFalse()
        ->and($report[0]['parts'])->toBe([['part' => 1, 'after_label' => null], ['part' => 2, 'after_label' => $passages[1]->label]])
        ->and($report[0]['statements'])->toBe([sprintf('Bentley (conjecture): %s 2/2 "fox" stands after %s', $passages[0]->label, $passages[1]->label)])
        ->and($shown[1]['discontinuous_witnesses'])->toBe([]);
});

test('every part of a divided line must be present, with its words', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passages' => $passages] = editionForOrdering(2);

    $pieces = [
        ['canonical_passage_id' => $passages[0]->id, 'part' => 1, 'text' => 'the quick'],
        ['canonical_passage_id' => $passages[1]->id, 'part' => 1, 'text' => 'line two'],
        ['canonical_passage_id' => $passages[0]->id, 'part' => 2, 'text' => 'fox'],
    ];

    // Part 2 without part 1: the passage is incomplete.
    $this->post(route('conjecture-orderings.store', $edition), ['pieces' => [$pieces[2], $pieces[1]], 'follow' => false])
        ->assertInvalid(['pieces']);

    $missingWords = $pieces;
    $missingWords[2]['text'] = '';
    $this->post(route('conjecture-orderings.store', $edition), ['pieces' => $missingWords, 'follow' => false])
        ->assertInvalid(['pieces']);

    expect(Conjecture::count())->toBe(0);
});

/**
 * Two lines with real words — "the quick fox" and "line two" — so a
 * division can be matched against the printed runs.
 *
 * @return array{work: Work, edition: Edition, passages: array{0: CanonicalPassage, 1: CanonicalPassage}}
 */
function editionWithWordyLines(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $layer = TranscriptionLayer::factory()->create(['text' => "the quick fox\nline two"]);
    $passages = [];

    foreach ([[1, 0, 13], [2, 14, 22]] as [$line, $start, $end]) {
        $formatted = $work->referenceScheme->format(['book' => 1, 'line' => $line]);
        $passage = CanonicalPassage::factory()->for($work)->create([
            'address' => ['book' => 1, 'line' => $line],
            'sort_key' => $formatted['sort_key'],
            'label' => $formatted['label'],
        ]);
        $segment = TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')->create(['start_offset' => $start, 'end_offset' => $end]);
        PassageAdder::add($edition, $segment, (float) $line);
        $passages[] = $passage;
    }

    return compact('work', 'edition', 'passages');
}

test('adopting an arrangement that divides a line prints the line in pieces, in the proposed order', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'passages' => $passages] = editionWithWordyLines();

    $this->post(route('conjecture-orderings.store', $edition), [
        'pieces' => [
            ['canonical_passage_id' => $passages[0]->id, 'part' => 1, 'text' => 'the quick'],
            ['canonical_passage_id' => $passages[1]->id, 'part' => 1, 'text' => 'line two'],
            ['canonical_passage_id' => $passages[0]->id, 'part' => 2, 'text' => 'fox'],
        ],
        'proposed_by' => 'Bentley',
    ])->assertRedirect();

    $rows = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->get();
    expect($rows->map(fn (EditionPassage $row) => [$row->canonical_passage_id, $row->part, $row->part_text])->all())
        // A line read whole keeps no words of its own; only the parts do.
        ->toBe([[$passages[0]->id, 1, 'the quick'], [$passages[1]->id, 1, null], [$passages[0]->id, 2, 'fox']])
        ->and(EditionTransposition::count())->toBe(1);

    $shown = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'];
    $printed = collect($shown)->map(fn (array $row) => [
        $row['label'], $row['part'], $row['parts'], $row['run_start'], $row['run_end'], $row['division_stale'],
        implode(' ', array_map(fn (array $run) => $run['text'], array_slice($row['runs'], $row['run_start'], $row['run_end'] - $row['run_start'] + 1))),
    ])->all();

    expect($printed)->toBe([
        [$passages[0]->label, 1, 2, 0, 1, false, 'the quick'],
        [$passages[1]->label, 1, 1, 0, 1, false, 'line two'],
        [$passages[0]->label, 2, 2, 2, 2, false, 'fox'],
    ]);

    // The edition now prints Bentley's arrangement: the report says the
    // line's ordering follows him, not that he varies from it.
    expect($shown[0]['discontinuous_witnesses'][0]['siglum'])->toBe('Bentley (conjecture)')
        ->and($shown[0]['discontinuous_witnesses'][0]['matches_current'])->toBeTrue();
});

test('adopting a registered arrangement from the line notice divides the line, and adopting a whole-line one rejoins it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passages' => $passages] = editionWithWordyLines();

    $this->post(route('conjecture-orderings.store', $edition), [
        'pieces' => [
            ['canonical_passage_id' => $passages[0]->id, 'part' => 1, 'text' => 'the quick'],
            ['canonical_passage_id' => $passages[1]->id, 'part' => 1, 'text' => 'line two'],
            ['canonical_passage_id' => $passages[0]->id, 'part' => 2, 'text' => 'fox'],
        ],
        'follow' => false,
    ])->assertRedirect();
    $divided = Conjecture::sole();
    expect(EditionPassage::where('edition_id', $edition->id)->count())->toBe(2);

    $this->post(route('edition-adoptions.store', $edition), ['conjecture_id' => $divided->id])->assertRedirect();
    expect(EditionPassage::where('edition_id', $edition->id)->count())->toBe(3)
        ->and(EditionTransposition::where('conjecture_id', $divided->id)->exists())->toBeTrue();

    // A proposal reading both lines whole, the other way round, rejoins the line.
    $this->post(route('conjecture-orderings.store', $edition), [
        'canonical_passage_ids' => [$passages[1]->id, $passages[0]->id],
    ])->assertRedirect();

    $rows = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->get();
    expect($rows->map(fn (EditionPassage $row) => [$row->canonical_passage_id, $row->part, $row->part_text])->all())
        ->toBe([[$passages[1]->id, 1, null], [$passages[0]->id, 1, null]]);
});

test('a guest cannot adopt a proposal', function () {
    $this->actingAs(User::factory()->create());
    ['edition' => $edition] = editionWithWordyLines();
    $conjecture = Conjecture::factory()->transposition()->create();

    $this->post(route('edition-adoptions.store', $edition), ['conjecture_id' => $conjecture->id])->assertForbidden();
});

test('whole passages as pieces are adopted like any reordering', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['edition' => $edition, 'passages' => $passages] = editionForOrdering(2);

    $this->post(route('conjecture-orderings.store', $edition), [
        'pieces' => [
            ['canonical_passage_id' => $passages[1]->id, 'part' => 1, 'text' => 'word'],
            ['canonical_passage_id' => $passages[0]->id, 'part' => 1, 'text' => 'word'],
        ],
    ])->assertRedirect();

    $stored = EditionPassage::where('edition_id', $edition->id)->orderBy('position')->pluck('canonical_passage_id')->all();
    expect($stored)->toBe([$passages[1]->id, $passages[0]->id])
        ->and(EditionTransposition::count())->toBe(1);
});
