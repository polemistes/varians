<?php

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionPassageOrder;
use App\Models\EditionTransposition;
use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * Adds $count canonical passages (book 1, lines 1..$count) to the edition,
 * each backed by its own throwaway transcription/segment — mirrors
 * EditionTranspositionControllerTest's addPassagesToEdition().
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
        $transcription = Transcription::factory()->create(['text' => 'word']);
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
        'bibliography' => 'Bergk, PLG 1882',
    ]);

    $response->assertRedirect();

    $conjecture = Conjecture::sole();
    expect($conjecture->type)->toBe(ConjectureType::Reordering)
        ->and($conjecture->proposed_by)->toBe('Bergk')
        ->and($conjecture->canonical_passage_id)->toBe($passages[0]->id) // first by citation order
        ->and($conjecture->orderingEntries->pluck('canonical_passage_id')->all())->toBe([$passages[2]->id, $passages[0]->id, $passages[1]->id]);

    $order = EditionPassageOrder::sole();
    expect($order->conjecture_id)->toBe($conjecture->id)
        ->and($order->transcription_id)->toBeNull()
        ->and(EditionTransposition::count())->toBe(0);

    $show = $this->get(route('editions.show', [$work, $edition]));
    $show->assertInertia(fn (AssertInertia $page) => $page
        ->where('windowPassages.0.label', $passages[2]->label)
        ->where('windowPassages.1.label', $passages[0]->label)
        ->where('windowPassages.2.label', $passages[1]->label));
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
