<?php

use App\Models\Assignment;
use App\Models\Segment;
use App\Models\Conjecture;
use App\Models\EditionComment;
use App\Models\Lemma;
use App\Models\TranscriptionLayer;
use App\Models\Witness;
use App\Support\Edition\SegmentAligner;

test('aligning two witnesses with identical text creates one column per word, each carrying both readings', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13]);
    $assignmentB = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentB]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings')->get();

    expect($lemmas)->toHaveCount(3);

    foreach ($lemmas as $lemma) {
        expect($lemma->readings)->toHaveCount(2);
    }
});

test('a single differing word becomes one column with two candidate readings, not two separate columns', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the slow fox']);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13]);
    $assignmentB = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 12]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentB]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with(['readings.transcriptionLayer'])->get();

    // "the" and "fox" are shared (2 readings each); "quick"/"slow" is one
    // variant site with two candidates — not two unrelated single-witness
    // columns, which is what a naive delete+insert reading would produce.
    expect($lemmas)->toHaveCount(3)
        ->and($lemmas[0]->readings)->toHaveCount(2)
        ->and($lemmas[2]->readings)->toHaveCount(2);

    $middleTexts = $lemmas[1]->readings
        ->map(fn ($reading) => mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset))
        ->sort()->values()->all();

    expect($middleTexts)->toBe(['quick', 'slow']);
});

test('a witness missing part of the segment simply has no reading there — not a false variant', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the fox']);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 19]);
    $assignmentB = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 7]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentB]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings')->get();

    expect($lemmas)->toHaveCount(4)
        ->and($lemmas[0]->readings)->toHaveCount(2) // the
        ->and($lemmas[1]->readings)->toHaveCount(1) // quick — only A
        ->and($lemmas[2]->readings)->toHaveCount(1) // brown — only A
        ->and($lemmas[3]->readings)->toHaveCount(2); // fox
});

test('two witnesses diverging in different, unrelated places each land as their own variant site', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the swift brown fox']);
    $c = TranscriptionLayer::factory()->create(['text' => 'the quick brown hound']);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 19]);
    $assignmentB = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 19]);
    $assignmentC = Assignment::factory()->for($c)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 21]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentB]));
    SegmentAligner::alignWitness($segment, collect([$assignmentC]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with(['readings.transcriptionLayer'])->get();

    // Four columns (the / quick-swift / brown / fox-hound), not six — B's
    // and C's divergences are each their own site, never merged with each
    // other, but each still merges with the base word it replaces.
    expect($lemmas)->toHaveCount(4);

    $textsFor = fn (Lemma $lemma) => $lemma->readings
        ->map(fn ($reading) => mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset))
        ->sort()->values()->all();

    expect($textsFor($lemmas[0]))->toBe(['the', 'the', 'the'])
        ->and($textsFor($lemmas[1]))->toBe(['quick', 'quick', 'swift'])
        ->and($textsFor($lemmas[2]))->toBe(['brown', 'brown', 'brown'])
        ->and($textsFor($lemmas[3]))->toBe(['fox', 'fox', 'hound']);
});

test('a segment assigned by two spans aligns as one witness, in part order rather than physical order', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    // B transposes "fox" to the head of its text; the assignment splits the
    // segment into two parts whose content order reverses their physical one.
    $b = TranscriptionLayer::factory()->create(['text' => "fox extra\nthe quick"]);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13]);
    $bFirst = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 10, 'end_offset' => 19, 'part' => 1]); // "the quick"
    $bLast = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]); // "fox"

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$bLast, $bFirst])); // deliberately unsorted

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings.transcriptionLayer')->get();

    // One witness, one token stream: the/quick/fox each carry both readings —
    // no phantom columns from B's parts being treated as separate witnesses.
    expect($lemmas)->toHaveCount(3);

    $textsFor = fn (Lemma $lemma) => $lemma->readings
        ->map(fn ($reading) => mb_substr($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset))
        ->sort()->values()->all();

    expect($textsFor($lemmas[0]))->toBe(['the', 'the'])
        ->and($textsFor($lemmas[1]))->toBe(['quick', 'quick'])
        ->and($textsFor($lemmas[2]))->toBe(['fox', 'fox']);

    // B's "fox" reading points at the span at the head of its text.
    $bFox = $lemmas[2]->readings->firstWhere('transcription_layer_id', $b->id);
    expect($bFox->start_offset)->toBe(0)->and($bFox->end_offset)->toBe(3);
});

test('collate aligns a split-assigning layer once, all parts together', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => 'the quick fox']);
    $b = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => "fox extra\nthe quick"]);
    Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13]);
    Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 10, 'end_offset' => 19, 'part' => 1]);
    Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 3, 'part' => 2]);

    SegmentAligner::collate($segment, Assignment::where('segment_id', $segment->id)->get());

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings')->get();

    expect($lemmas)->toHaveCount(3);

    foreach ($lemmas as $lemma) {
        expect($lemma->readings)->toHaveCount(2);
    }
});

test('a substitution merge never fuses tokens from different parts into one reading', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    // B's differing words straddle its part boundary: "swift" ends part 1,
    // "hound" is all of part 2, physically earlier in the text. Merged into
    // one reading, its offsets would run backwards across the gap.
    $b = TranscriptionLayer::factory()->create(['text' => "hound\nthe swift"]);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 13]);
    $bFirst = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 6, 'end_offset' => 15, 'part' => 1]); // "the swift"
    $bLast = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 5, 'part' => 2]); // "hound"

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$bFirst, $bLast]));

    $readings = Lemma::where('segment_id', $segment->id)
        ->with('readings')->get()
        ->flatMap(fn (Lemma $lemma) => $lemma->readings)
        ->filter(fn ($reading) => $reading->transcription_layer_id === $b->id);

    // Every reading describes a real, forward, single-part span.
    foreach ($readings as $reading) {
        expect($reading->end_offset)->toBeGreaterThan($reading->start_offset);
    }

    $texts = $readings
        ->map(fn ($reading) => mb_substr($b->text, $reading->start_offset, $reading->end_offset - $reading->start_offset))
        ->sort()->values()->all();

    expect($texts)->toBe(['hound', 'swift', 'the']);
});

test('aligning the same transcription twice is a no-op', function () {
    $segment = Segment::factory()->create();
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the fox']);
    $assignment = Assignment::factory()->for($transcription)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 7]);

    SegmentAligner::alignWitness($segment, collect([$assignment]));
    SegmentAligner::alignWitness($segment, collect([$assignment]));

    expect(Lemma::where('segment_id', $segment->id)->count())->toBe(2);
});

test('a single base word replaced by a three-word witness variant merges into one column, no phantom columns', function () {
    $segment = Segment::factory()->create();
    $aText = 'the fox sleeps';
    $bText = 'the exceedingly swift creature sleeps';
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $b = TranscriptionLayer::factory()->create(['text' => $bText]);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $assignmentB = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($bText)]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentB]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings.transcriptionLayer')->get();

    // the / fox~"exceedingly swift creature" / sleeps — three columns, not
    // five (which is what today's 1-for-1-plus-orphaned-leftovers bug
    // would produce: "fox"~"exceedingly" plus two phantom gap columns).
    expect($lemmas)->toHaveCount(3);

    $merged = $lemmas[1]->readings->firstWhere('transcription_layer_id', $b->id);
    expect($merged->range_end_lemma_id)->toBeNull() // only one existing lemma involved
        ->and(mb_substr($merged->transcriptionLayer->text, $merged->start_offset, $merged->end_offset - $merged->start_offset))
        ->toBe('exceedingly swift creature');
});

test('a three-word base phrase collapsed to one witness word spans the range via range_end_lemma_id', function () {
    $segment = Segment::factory()->create();
    $aText = 'the swift red fox sleeps';
    $bText = 'the creature sleeps';
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $b = TranscriptionLayer::factory()->create(['text' => $bText]);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $assignmentB = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($bText)]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentB]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings.transcriptionLayer')->get();

    expect($lemmas)->toHaveCount(5); // the / swift / red / fox / sleeps — structure unchanged, nothing merged
    expect($lemmas[2]->readings)->toHaveCount(1) // "red" — only A, no reading from B
        ->and($lemmas[3]->readings)->toHaveCount(1); // "fox" — only A

    $merged = $lemmas[1]->readings->firstWhere('transcription_layer_id', $b->id); // anchored at "swift"
    expect($merged->range_end_lemma_id)->toBe($lemmas[3]->id) // through "fox", inclusive
        ->and(mb_substr($merged->transcriptionLayer->text, $merged->start_offset, $merged->end_offset - $merged->start_offset))->toBe('creature');
});

test('a two-word base phrase replaced by a three-word witness variant merges into one column spanning both', function () {
    $segment = Segment::factory()->create();
    $aText = 'the swift fox sleeps';
    $bText = 'the creature very quickly sleeps';
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $b = TranscriptionLayer::factory()->create(['text' => $bText]);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $assignmentB = Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($bText)]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentB]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings.transcriptionLayer')->get();

    expect($lemmas)->toHaveCount(4); // the / swift / fox / sleeps — unaffected

    $merged = $lemmas[1]->readings->firstWhere('transcription_layer_id', $b->id);
    expect($merged->range_end_lemma_id)->toBe($lemmas[2]->id)
        ->and(mb_substr($merged->transcriptionLayer->text, $merged->start_offset, $merged->end_offset - $merged->start_offset))->toBe('creature very quickly');
});

test('a swallowed interior lemma keeps its own independent readings from other witnesses, unaffected by an anchor range', function () {
    $segment = Segment::factory()->create();
    $aText = 'the swift fox sleeps';
    $cText = 'the creature very quickly sleeps'; // merges swift+fox
    $dText = 'the swift fox sleeps'; // plain 1:1, same wording as A
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $c = TranscriptionLayer::factory()->create(['text' => $cText]);
    $d = TranscriptionLayer::factory()->create(['text' => $dText]);
    $assignmentA = Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $assignmentC = Assignment::factory()->for($c)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($cText)]);
    $assignmentD = Assignment::factory()->for($d)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => mb_strlen($dText)]);

    SegmentAligner::alignWitness($segment, collect([$assignmentA]));
    SegmentAligner::alignWitness($segment, collect([$assignmentC]));
    SegmentAligner::alignWitness($segment, collect([$assignmentD]));

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->with('readings')->get();
    expect($lemmas)->toHaveCount(4);

    // "fox" (swallowed by C's range) still independently carries A's and D's plain 1:1 readings.
    expect($lemmas[2]->readings)->toHaveCount(2)
        ->and($lemmas[2]->readings->pluck('range_end_lemma_id')->filter()->isEmpty())->toBeTrue();

    // "swift" now carries three readings on the same lemma: A's own word, D's duplicate, and C's range.
    expect($lemmas[1]->readings)->toHaveCount(3);
});

test('collating records one omission reading per run of columns a witness lacks, anchored where its words resume', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => 'the quick brown fox']);
    $b = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => 'the fox']);
    Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 19]);
    Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 7]);

    SegmentAligner::collate($segment, Assignment::where('segment_id', $segment->id)->get());

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->get();
    $omissions = SegmentAligner::layerReadings($segment, $b)->where('omitted', true)->values();

    // One reading for "quick brown" as a whole, not one per column; B's
    // text resumes at offset 3 (after "the"), and that is where it sits.
    expect($omissions)->toHaveCount(1)
        ->and($omissions[0]->lemma_id)->toBe($lemmas[1]->id)
        ->and($omissions[0]->range_end_lemma_id)->toBe($lemmas[2]->id)
        ->and($omissions[0]->start_offset)->toBe(3)
        ->and($omissions[0]->end_offset)->toBe(3)
        ->and(SegmentAligner::layerReadings($segment, $a)->where('omitted', true))->toHaveCount(0);
});

test('re-collating keeps an existing omission reading rather than replacing it', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => 'the quick brown fox']);
    $b = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => 'the fox']);
    Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 19]);
    Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 7]);

    SegmentAligner::collate($segment, Assignment::where('segment_id', $segment->id)->get());
    $before = SegmentAligner::layerReadings($segment, $b)->where('omitted', true)->sole();

    // Something editorial pins the columns, so the second collation
    // appends instead of rebuilding — the case an upsert has to survive.
    EditionComment::factory()->create(['lemma_id' => $before->lemma_id]);
    SegmentAligner::recordOmissions($segment);

    $after = SegmentAligner::layerReadings($segment, $b)->where('omitted', true)->sole();

    expect($after->id)->toBe($before->id)
        ->and($after->range_end_lemma_id)->toBe($before->range_end_lemma_id);
});

test('a column no witness attests breaks an omission run instead of being swallowed by it', function () {
    $segment = Segment::factory()->create();
    $a = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'A']))->create(['text' => 'the quick brown fox']);
    $b = TranscriptionLayer::factory()->for(Witness::factory()->create(['siglum' => 'B']))->create(['text' => 'the fox']);
    Assignment::factory()->for($a)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 19]);
    Assignment::factory()->for($b)->for($segment, 'segment')->create(['start_offset' => 0, 'end_offset' => 7]);

    SegmentAligner::collate($segment, Assignment::where('segment_id', $segment->id)->get());

    $lemmas = Lemma::where('segment_id', $segment->id)->orderBy('position')->get();

    // A lacuna column between "quick" and "brown" — nobody's word.
    $lacuna = Lemma::create(['segment_id' => $segment->id, 'position' => ((float) $lemmas[1]->position + (float) $lemmas[2]->position) / 2]);
    $lacuna->readings()->create(['conjecture_id' => Conjecture::factory()->create(['type' => 'lacuna', 'text' => null])->id]);

    SegmentAligner::recordOmissions($segment);

    $omissions = SegmentAligner::layerReadings($segment, $b)->where('omitted', true)->sortBy('lemma_id')->values();

    expect($omissions)->toHaveCount(2)
        ->and($omissions->pluck('lemma_id')->all())->toBe([$lemmas[1]->id, $lemmas[2]->id])
        ->and($omissions->pluck('range_end_lemma_id')->all())->toBe([null, null]);
});
