<?php

use App\Models\Assignment;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * One segment collated from two witnesses, the first seeding the columns, and
 * a second edition based on the other — the arrangement in which the base's
 * own words no longer divide one-per-column.
 *
 * @return array{work: Work, segment: Segment, edition: Edition, base: TranscriptionLayer}
 */
function segmentBasedOnNonSeed(string $seedText, string $baseText): array
{
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);

    // Sigla pinned so the seed witness is deterministic — witnesses align in
    // siglum order, and these tests turn on which one built the columns.
    $seed = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => $seedText]);
    $base = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => $baseText]);
    $seedAssignment = Assignment::factory()->for($seed)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($seedText)]);
    $baseAssignment = Assignment::factory()->for($base)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($baseText)]);

    SegmentAdder::add(Edition::factory()->for($work)->create(['title' => 'Seeded']), $seedAssignment, 1.0);

    $edition = Edition::factory()->for($work)->create(['title' => 'Based on the other']);
    SegmentAdder::add($edition, $baseAssignment, 1.0);

    return ['work' => $work, 'segment' => $segment, 'edition' => $edition, 'base' => $base];
}

/**
 * Adopt an already-catalogued conjecture for this edition. Authoring a new
 * substitution only records it as a candidate — adopting is a separate,
 * explicit act (see EditionVariantController::store).
 */
function adoptConjecture(Edition $edition, Segment $segment, LemmaReading $reading): void
{
    test()->post(route('edition-variants.store', $edition), [
        'segment_id' => $segment->id,
        'lemma_id' => $reading->lemma_id,
        'source' => 'existing_conjecture',
        'conjecture_id' => $reading->conjecture_id,
    ])->assertRedirect()->assertSessionHasNoErrors();
}

test('a conjecture can be placed on a base word inside a merged reading', function () {
    // The base reads "exceedingly swift creature" where the seed witness has
    // one word, so the whole phrase is a single column. Selecting just
    // "exceedingly" (4-15) has no exact column boundary to match; it used to
    // be rejected with "This segment's structure has changed".
    $this->actingAs(User::factory()->editor()->create());

    ['segment' => $segment, 'edition' => $edition] =
        segmentBasedOnNonSeed('the fox sleeps', 'the exceedingly swift creature sleeps');

    $this->post(route('edition-variants.store', $edition), [
        'segment_id' => $segment->id,
        'placement' => 'range',
        'range_start_base_offset' => 4,
        'range_end_base_offset' => 15,
        'source' => 'new_conjecture',
        'conjecture_text' => 'emendation',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $reading = LemmaReading::whereNotNull('conjecture_id')->sole();
    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->get();

    // Landed on the column the base's "exceedingly swift creature" occupies.
    expect($reading->conjecture->text)->toBe('emendation')
        ->and($reading->lemma_id)->toBe($lemmas[1]->id);
});

test('the selection snaps to the whole variant site, not the words selected', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'segment' => $segment, 'edition' => $edition] =
        segmentBasedOnNonSeed('the fox sleeps', 'the exceedingly swift creature sleeps');

    $this->post(route('edition-variants.store', $edition), [
        'segment_id' => $segment->id,
        'placement' => 'range',
        'range_start_base_offset' => 4,
        'range_end_base_offset' => 15, // just "exceedingly"
        'source' => 'new_conjecture',
        'conjecture_text' => 'emendation',
    ])->assertRedirect();

    adoptConjecture($edition, $segment, LemmaReading::whereNotNull('conjecture_id')->sole());

    // The conjecture replaces the entire site, so the printed line is the
    // base's words with the whole phrase swapped out — never a half-column.
    $this->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->where('windowSegments.0.runs.1.text', 'emendation')
            ->has('windowSegments.0.runs', 3));
});

test('a conjecture over a base reading that spans columns claims all of them', function () {
    // Here the base is the *shorter* witness: its "creature" spans three of
    // the seed's columns. A conjecture replacing it must claim the same
    // ground, or the columns left uncovered would render beside it and splice
    // the seed's words back into the printed text.
    $this->actingAs(User::factory()->editor()->create());

    ['work' => $work, 'segment' => $segment, 'edition' => $edition] =
        segmentBasedOnNonSeed('the swift red fox sleeps', 'the creature sleeps');

    $this->post(route('edition-variants.store', $edition), [
        'segment_id' => $segment->id,
        'placement' => 'range',
        'range_start_base_offset' => 4,
        'range_end_base_offset' => 12, // "creature"
        'source' => 'new_conjecture',
        'conjecture_text' => 'emendation',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $reading = LemmaReading::whereNotNull('conjecture_id')->sole();
    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->get();

    // Claims every column the base's own "creature" stood for.
    expect($reading->range_end_lemma_id)->toBe($lemmas[3]->id);

    adoptConjecture($edition, $segment, $reading);

    $runs = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowSegments'][0]['runs'];

    expect(implode(' ', array_column($runs, 'text')))->toBe('the emendation sleeps');
});

test('an offset outside every reading is still rejected', function () {
    $this->actingAs(User::factory()->editor()->create());

    ['segment' => $segment, 'edition' => $edition] =
        segmentBasedOnNonSeed('the fox sleeps', 'the exceedingly swift creature sleeps');

    $this->post(route('edition-variants.store', $edition), [
        'segment_id' => $segment->id,
        'placement' => 'range',
        'range_start_base_offset' => 900,
        'range_end_base_offset' => 950,
        'source' => 'new_conjecture',
        'conjecture_text' => 'emendation',
    ])->assertInvalid(['range_start_base_offset']);
});
