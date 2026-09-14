<?php

use App\Models\Assignment;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\ReferenceScheme;
use App\Models\Segment;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;
use App\Support\Edition\SegmentAligner;
use App\Support\Transcription\AssignmentIntegrity;
use Inertia\Testing\AssertableInertia;

/**
 * A word divided at the end of a manuscript line ("ἄνδ-⏎ρα") is one word
 * throughout: it collates as "ἄνδρα" and is no variant of a witness that
 * has it whole, an assignment cannot end inside it, and the edition prints
 * it whole on one line while the apparatus shows how the manuscript
 * divides it. See App\Support\Transcription\WordDivision.
 */
function dividedWordSetup(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $edition = Edition::factory()->for($work)->create();
    $segment = Segment::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);

    // A: the word divided at the line's end, in both layers.
    $transcription = Transcription::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)->create(['text' => "ΑΝΔ-\nΡΑ ΜΟΙ"]);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => "ἄνδ-\nρα μοι"]);
    $assignment = Assignment::factory()->for($normalized)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 11]);
    Assignment::factory()->for($diplomatic)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 11]);

    // B: the word whole.
    $other = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => 'ἄνδρα μοι']);
    Assignment::factory()->for($other)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 9]);

    return compact('work', 'edition', 'segment', 'normalized', 'diplomatic', 'other', 'assignment');
}

test('a word divided at a line\'s end collates as one word and is no variant', function () {
    ['segment' => $segment, 'normalized' => $normalized, 'other' => $other] = dividedWordSetup();

    SegmentAligner::collate($segment, Assignment::where('segment_id', $segment->id)
        ->whereIn('transcription_layer_id', [$normalized->id, $other->id])->get());

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings')->get();

    expect($lemmas)->toHaveCount(2)
        ->and($lemmas[0]->readings)->toHaveCount(2)
        ->and(SegmentAligner::layerReadings($segment, $normalized)->first()->start_offset)->toBe(0)
        ->and(SegmentAligner::layerReadings($segment, $normalized)->first()->end_offset)->toBe(7);
});

test('the edition prints the word whole, and the apparatus shows how the manuscript divides it', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'edition' => $edition, 'assignment' => $assignment, 'normalized' => $normalized, 'diplomatic' => $diplomatic] = dividedWordSetup();
    $normalized->transcription->update(['visibility' => 'published']);
    SegmentAdder::add($edition, $assignment, 1.0);

    $this->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('windowSegments.0.runs.0.text', 'ἄνδρα')
            ->missing('windowSegments.0.runs.0.break_before')
            ->where('windowSegments.0.runs.1.text', 'μοι')
            // The edition's own lineation: no line break inside the word,
            // nor before μοι — the manuscript's line end was a division.
            ->missing('windowSegments.0.runs.1.break_before')
            ->where('windowSegments.0.runs.0.diplomatic', 'ΑΝΔ-|ΡΑ')
            ->where('windowSegments.0.base_diplomatic', 'ΑΝΔ-|ΡΑ ΜΟΙ'));
});

test('an assignment cannot end inside a divided word, and one across it is not flagged', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'normalized' => $normalized] = dividedWordSetup();
    $normalized->assignments()->delete();

    $this->post(route('assignments.store', $normalized), [
        'work_id' => $work->id,
        'label' => '1.2',
        'start_offset' => 0,
        'end_offset' => 4, // "ἄνδ-" — the word goes on
    ])->assertRedirect()->assertSessionHasNoErrors();

    $span = $normalized->assignments()->sole();

    expect([$span->start_offset, $span->end_offset])->toBe([0, 7])
        ->and($span->boundary_review)->toBeFalse()
        ->and(AssignmentIntegrity::issues($normalized->fresh()))->toBe([]);
});
