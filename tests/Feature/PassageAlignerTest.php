<?php

use App\Models\CanonicalPassage;
use App\Models\Lemma;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Support\Edition\PassageAligner;

test('aligning two witnesses with identical text creates one column per word, each carrying both readings', function () {
    $passage = CanonicalPassage::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);
    $segmentB = TranscriptionSegment::factory()->for($b)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentB);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings')->get();

    expect($lemmas)->toHaveCount(3);

    foreach ($lemmas as $lemma) {
        expect($lemma->readings)->toHaveCount(2);
    }
});

test('a single differing word becomes one column with two candidate readings, not two separate columns', function () {
    $passage = CanonicalPassage::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the slow fox']);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);
    $segmentB = TranscriptionSegment::factory()->for($b)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 12]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentB);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with(['readings.transcriptionLayer'])->get();

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

test('a witness missing part of the passage simply has no reading there — not a false variant', function () {
    $passage = CanonicalPassage::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the fox']);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 19]);
    $segmentB = TranscriptionSegment::factory()->for($b)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 7]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentB);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings')->get();

    expect($lemmas)->toHaveCount(4)
        ->and($lemmas[0]->readings)->toHaveCount(2) // the
        ->and($lemmas[1]->readings)->toHaveCount(1) // quick — only A
        ->and($lemmas[2]->readings)->toHaveCount(1) // brown — only A
        ->and($lemmas[3]->readings)->toHaveCount(2); // fox
});

test('two witnesses diverging in different, unrelated places each land as their own variant site', function () {
    $passage = CanonicalPassage::factory()->create();
    $a = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $b = TranscriptionLayer::factory()->create(['text' => 'the swift brown fox']);
    $c = TranscriptionLayer::factory()->create(['text' => 'the quick brown hound']);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 19]);
    $segmentB = TranscriptionSegment::factory()->for($b)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 19]);
    $segmentC = TranscriptionSegment::factory()->for($c)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 21]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentB);
    PassageAligner::alignWitness($passage, $segmentC);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with(['readings.transcriptionLayer'])->get();

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

test('aligning the same transcription twice is a no-op', function () {
    $passage = CanonicalPassage::factory()->create();
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 7]);

    PassageAligner::alignWitness($passage, $segment);
    PassageAligner::alignWitness($passage, $segment);

    expect(Lemma::where('canonical_passage_id', $passage->id)->count())->toBe(2);
});

test('a single base word replaced by a three-word witness variant merges into one column, no phantom columns', function () {
    $passage = CanonicalPassage::factory()->create();
    $aText = 'the fox sleeps';
    $bText = 'the exceedingly swift creature sleeps';
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $b = TranscriptionLayer::factory()->create(['text' => $bText]);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $segmentB = TranscriptionSegment::factory()->for($b)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($bText)]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentB);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings.transcriptionLayer')->get();

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
    $passage = CanonicalPassage::factory()->create();
    $aText = 'the swift red fox sleeps';
    $bText = 'the creature sleeps';
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $b = TranscriptionLayer::factory()->create(['text' => $bText]);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $segmentB = TranscriptionSegment::factory()->for($b)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($bText)]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentB);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings.transcriptionLayer')->get();

    expect($lemmas)->toHaveCount(5); // the / swift / red / fox / sleeps — structure unchanged, nothing merged
    expect($lemmas[2]->readings)->toHaveCount(1) // "red" — only A, no reading from B
        ->and($lemmas[3]->readings)->toHaveCount(1); // "fox" — only A

    $merged = $lemmas[1]->readings->firstWhere('transcription_layer_id', $b->id); // anchored at "swift"
    expect($merged->range_end_lemma_id)->toBe($lemmas[3]->id) // through "fox", inclusive
        ->and(mb_substr($merged->transcriptionLayer->text, $merged->start_offset, $merged->end_offset - $merged->start_offset))->toBe('creature');
});

test('a two-word base phrase replaced by a three-word witness variant merges into one column spanning both', function () {
    $passage = CanonicalPassage::factory()->create();
    $aText = 'the swift fox sleeps';
    $bText = 'the creature very quickly sleeps';
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $b = TranscriptionLayer::factory()->create(['text' => $bText]);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $segmentB = TranscriptionSegment::factory()->for($b)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($bText)]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentB);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings.transcriptionLayer')->get();

    expect($lemmas)->toHaveCount(4); // the / swift / fox / sleeps — unaffected

    $merged = $lemmas[1]->readings->firstWhere('transcription_layer_id', $b->id);
    expect($merged->range_end_lemma_id)->toBe($lemmas[2]->id)
        ->and(mb_substr($merged->transcriptionLayer->text, $merged->start_offset, $merged->end_offset - $merged->start_offset))->toBe('creature very quickly');
});

test('a swallowed interior lemma keeps its own independent readings from other witnesses, unaffected by an anchor range', function () {
    $passage = CanonicalPassage::factory()->create();
    $aText = 'the swift fox sleeps';
    $cText = 'the creature very quickly sleeps'; // merges swift+fox
    $dText = 'the swift fox sleeps'; // plain 1:1, same wording as A
    $a = TranscriptionLayer::factory()->create(['text' => $aText]);
    $c = TranscriptionLayer::factory()->create(['text' => $cText]);
    $d = TranscriptionLayer::factory()->create(['text' => $dText]);
    $segmentA = TranscriptionSegment::factory()->for($a)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($aText)]);
    $segmentC = TranscriptionSegment::factory()->for($c)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($cText)]);
    $segmentD = TranscriptionSegment::factory()->for($d)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => mb_strlen($dText)]);

    PassageAligner::alignWitness($passage, $segmentA);
    PassageAligner::alignWitness($passage, $segmentC);
    PassageAligner::alignWitness($passage, $segmentD);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings')->get();
    expect($lemmas)->toHaveCount(4);

    // "fox" (swallowed by C's range) still independently carries A's and D's plain 1:1 readings.
    expect($lemmas[2]->readings)->toHaveCount(2)
        ->and($lemmas[2]->readings->pluck('range_end_lemma_id')->filter()->isEmpty())->toBeTrue();

    // "swift" now carries three readings on the same lemma: A's own word, D's duplicate, and C's range.
    expect($lemmas[1]->readings)->toHaveCount(3);
});
