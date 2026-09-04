<?php

use App\Models\CanonicalPassage;
use App\Models\Lemma;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAligner;

/**
 * A cut op and the paste of exactly its text, linked by a shared cut_id, are
 * a relocation: everything anchored wholly inside the cut travels with the
 * words. This replaces the old one-click "Move this passage" — the editor
 * now simply cuts and pastes in the always-editable transcript.
 */
test('cut and paste of a cited span moves the citation with the words', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 10, // "quick "
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 13, 'end' => 13, 'text' => 'quick ', 'cut_id' => 'c1'],
        ],
        'text' => 'the brown foxquick ',
    ]);

    $response->assertRedirect();
    expect($transcription->fresh()->text)->toBe('the brown foxquick ');

    $segment->refresh();
    expect($segment->start_offset)->toBe(13)
        ->and($segment->end_offset)->toBe(19)
        ->and($segment->needs_review)->toBeFalse()
        ->and(mb_substr($transcription->fresh()->text, $segment->start_offset, 6))->toBe('quick ');
});

test('the same two ops WITHOUT a cut_id tombstone the citation instead of moving it', function () {
    // The inverse of the old MoveAssignedPassageTest raison-d'être case: a
    // plain delete + unrelated insert is not a relocation claim.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 10,
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => ''],
            ['start' => 13, 'end' => 13, 'text' => 'quick '],
        ],
        'text' => 'the brown foxquick ',
    ]);

    $response->assertRedirect();
    $segment->refresh();
    expect($segment->end_offset)->toBe($segment->start_offset)
        ->and($segment->needs_review)->toBeTrue();
});

test('a backward cut and paste moves the citation too', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 10, // "quick "
    ]);

    $response = $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 0, 'end' => 0, 'text' => 'quick ', 'cut_id' => 'c1'],
        ],
        'text' => 'quick the brown fox',
    ]);

    $response->assertRedirect();
    $segment->refresh();
    expect($segment->start_offset)->toBe(0)
        ->and($segment->end_offset)->toBe(6)
        ->and($segment->needs_review)->toBeFalse();
});

test('an image region anchored to the moved words travels with them', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $region = TranscriptionRegion::factory()->for($transcription)->for(ManuscriptImage::factory())->create([
        'start_offset' => 4, 'end_offset' => 9, 'text' => 'quick',
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 13, 'end' => 13, 'text' => 'quick ', 'cut_id' => 'c1'],
        ],
        'text' => 'the brown foxquick ',
    ])->assertRedirect();

    $region->refresh();
    expect($region->start_offset)->toBe(13)
        ->and($region->end_offset)->toBe(18)
        ->and($region->text)->toBe('quick');
});

test('a collated reading inside the moved words travels with them', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick fox']);
    $passage = CanonicalPassage::factory()->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 13]);
    PassageAligner::alignWitness($passage, collect([$segment]));

    $quick = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings')->get()[1]
        ->readings->first();
    expect($quick->start_offset)->toBe(4); // sanity: "quick"

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 7, 'end' => 7, 'text' => 'quick ', 'cut_id' => 'c1'],
        ],
        'text' => 'the foxquick ',
    ])->assertRedirect();

    $quick->refresh();
    expect($quick->start_offset)->toBe(7)
        ->and($quick->end_offset)->toBe(12)
        ->and(mb_substr($transcription->fresh()->text, $quick->start_offset, 5))->toBe('quick');
});

test('a citation outside the moved stretch shifts rather than travelling', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $fox = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 16, 'end_offset' => 19, // "fox"
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 0, 'end' => 0, 'text' => 'quick ', 'cut_id' => 'c1'],
        ],
        'text' => 'quick the brown fox',
    ])->assertRedirect();

    $fox->refresh();
    expect($fox->start_offset)->toBe(16)
        ->and($fox->end_offset)->toBe(19)
        ->and($fox->needs_review)->toBeFalse();
});

test('a cut saved without its paste tombstones the citation — recoverable, not destroyed', function () {
    // Autosave can split a cut and its paste across two requests; the first
    // half must degrade safely.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 10,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1']],
        'text' => 'the brown fox',
    ])->assertRedirect();

    $segment->refresh();
    expect($segment->start_offset)->toBe(4)
        ->and($segment->end_offset)->toBe(4)
        ->and($segment->needs_review)->toBeTrue();
});

test('a paste whose text does not match its cut is not honoured as a relocation', function () {
    // The server recomputes what the cut removed; a client cannot pair
    // unrelated ops and teleport a citation onto words it never covered.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $segment = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 4, 'end_offset' => 10,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 4, 'end' => 10, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 13, 'end' => 13, 'text' => 'DIFFERENT ', 'cut_id' => 'c1'],
        ],
        'text' => 'the brown foxDIFFERENT ',
    ])->assertRedirect();

    $segment->refresh();
    expect($segment->end_offset)->toBe($segment->start_offset)
        ->and($segment->needs_review)->toBeTrue();
});

test('pasting a cut line right after another cited line does not absorb into it', function () {
    // The real scenario that surfaced this: relocate line one to after line
    // two, with the paste landing exactly at line two's citation end.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "alpha\nbeta"]);
    $alpha = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 0, 'end_offset' => 5,
    ]);
    $beta = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 6, 'end_offset' => 10,
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 0, 'end' => 6, 'text' => '', 'cut_id' => 'c1'], // "alpha\n"
            ['start' => 4, 'end' => 4, 'text' => "alpha\n", 'cut_id' => 'c1'], // after "beta"
        ],
        'text' => "betaalpha\n",
    ])->assertRedirect();

    $alpha->refresh();
    $beta->refresh();
    expect($beta->start_offset)->toBe(0)
        ->and($beta->end_offset)->toBe(4) // "beta" — NOT extended over the arrival
        ->and($beta->needs_review)->toBeFalse()
        ->and($alpha->start_offset)->toBe(4)
        ->and($alpha->end_offset)->toBe(9) // "alpha", relocated
        ->and($alpha->needs_review)->toBeFalse();
});

test('a cut fragment of a cited span keeps its own citation as a new part, and splits the span it lands inside', function () {
    // "the quick brown fox" cites α, "line two" cites β. Cut " brown fox"
    // (the tail of α) and paste it into the middle of β, after "line".
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "the quick brown fox\nline two"]);
    $alpha = CanonicalPassage::factory()->create();
    $beta = CanonicalPassage::factory()->create();
    $alphaSegment = TranscriptionSegment::factory()->for($transcription)->for($alpha, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 19]);
    $betaSegment = TranscriptionSegment::factory()->for($transcription)->for($beta, 'canonicalPassage')
        ->create(['start_offset' => 20, 'end_offset' => 28]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 9, 'end' => 19, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 14, 'end' => 14, 'text' => ' brown fox', 'cut_id' => 'c1'],
        ],
        'text' => "the quick\nline brown fox two",
    ])->assertRedirect();

    $text = $transcription->fresh()->text;
    expect($text)->toBe("the quick\nline brown fox two");

    // The source keeps α on what remains — trimmed, clean, unflagged.
    $alphaSegment->refresh();
    expect([$alphaSegment->start_offset, $alphaSegment->end_offset])->toBe([0, 9])
        ->and($alphaSegment->needs_review)->toBeFalse()
        ->and($alphaSegment->part)->toBe(1);

    // The fragment is a new PART of α at the paste site.
    $fragment = TranscriptionSegment::where('transcription_layer_id', $transcription->id)
        ->where('canonical_passage_id', $alpha->id)->where('part', 2)->sole();
    expect([$fragment->start_offset, $fragment->end_offset])->toBe([14, 24])
        ->and(mb_substr($text, $fragment->start_offset, 10))->toBe(' brown fox')
        ->and($fragment->needs_review)->toBeFalse();

    // β keeps citing both sides of the arrival: split into two parts.
    $betaParts = TranscriptionSegment::where('transcription_layer_id', $transcription->id)
        ->where('canonical_passage_id', $beta->id)->inPartOrder()->get();
    expect($betaParts)->toHaveCount(2)
        ->and([$betaParts[0]->start_offset, $betaParts[0]->end_offset])->toBe([10, 14]) // "line"
        ->and([$betaParts[1]->start_offset, $betaParts[1]->end_offset])->toBe([24, 28]) // " two"
        ->and($betaParts->every(fn ($part) => ! $part->needs_review))->toBeTrue()
        ->and($betaParts[0]->id)->toBe($betaSegment->id);
});

test('a fragment cut from a span\'s head reads as the part BEFORE what remains', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "the quick fox\nrest"]);
    $alpha = CanonicalPassage::factory()->create();
    $segment = TranscriptionSegment::factory()->for($transcription)->for($alpha, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 13]);

    // Cut "the " (the head) and paste it at the very end.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 0, 'end' => 4, 'text' => '', 'cut_id' => 'c1'],
            ['start' => 14, 'end' => 14, 'text' => 'the ', 'cut_id' => 'c1'],
        ],
        'text' => "quick fox\nrestthe ",
    ])->assertRedirect();

    $parts = TranscriptionSegment::where('transcription_layer_id', $transcription->id)
        ->where('canonical_passage_id', $alpha->id)->inPartOrder()->get();

    // Content order: "the " still reads FIRST, wherever it physically sits.
    expect($parts)->toHaveCount(2)
        ->and([$parts[0]->start_offset, $parts[0]->end_offset])->toBe([14, 18]) // "the ", part 1
        ->and([$parts[1]->start_offset, $parts[1]->end_offset])->toBe([0, 9])   // "quick fox", part 2
        ->and($parts[1]->id)->toBe($segment->id)
        ->and($parts->every(fn ($part) => ! $part->needs_review))->toBeTrue();
});

test('cutting a whole line carries exactly the selection — its newline travels when selected', function () {
    // No hidden whole-line heuristics: the editor sees the selection and the
    // result, so what is cut is precisely what was selected.
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => "alpha\nbeta\ngamma"]);
    $beta = TranscriptionSegment::factory()->for($transcription)->create([
        'start_offset' => 6, 'end_offset' => 10, // "beta"
    ]);

    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 6, 'end' => 11, 'text' => '', 'cut_id' => 'c1'], // "beta\n"
            ['start' => 0, 'end' => 0, 'text' => "beta\n", 'cut_id' => 'c1'],
        ],
        'text' => "beta\nalpha\ngamma",
    ])->assertRedirect();

    expect($transcription->fresh()->text)->toBe("beta\nalpha\ngamma");
    $beta->refresh();
    expect($beta->start_offset)->toBe(0)
        ->and($beta->end_offset)->toBe(4)
        ->and($beta->needs_review)->toBeFalse();
});

test('undoing a partial relocation merges the fragment back into its remainder', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 15]); // "the quick brown"

    // Cut " brown" out of the cited span and paste it at the end — the
    // fragment becomes part 2 (the forward move).
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 9, 'end' => 15, 'text' => '', 'cut_id' => 'f1'],
            ['start' => 13, 'end' => 13, 'text' => ' brown', 'cut_id' => 'f1'],
        ],
        'text' => 'the quick fox brown',
    ])->assertRedirect();

    expect($transcription->segments()->count())->toBe(2);

    // The reverse move (what undo replays, with a fresh pair id): the
    // fragment rejoins its remainder — and so must the rows.
    $this->patch(route('transcriptions.text.update', $transcription), [
        'ops' => [
            ['start' => 13, 'end' => 19, 'text' => '', 'cut_id' => 'f2'],
            ['start' => 9, 'end' => 9, 'text' => ' brown', 'cut_id' => 'f2'],
        ],
        'text' => 'the quick brown fox',
    ])->assertRedirect();

    $merged = $transcription->segments()->sole();

    expect([$merged->start_offset, $merged->end_offset])->toBe([0, 15]);
});
