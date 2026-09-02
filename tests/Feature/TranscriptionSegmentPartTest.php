<?php

use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\ReferenceScheme;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Work;
use App\Support\Edition\PassageAligner;

/**
 * A layer whose text for one passage is discontinuous — "the quick" cited in
 * place, "fox" transposed to the head of the text — plus the work/scheme the
 * store route needs to resolve the label.
 *
 * @return array{work: Work, layer: TranscriptionLayer, passage: CanonicalPassage}
 */
function splitCitationSetup(): array
{
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    // "fox" (0..3) belongs at the END of the passage but stands first.
    $layer = TranscriptionLayer::factory()->create(['text' => "fox\nthe quick"]);
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);

    $layer->segments()->create([
        'canonical_passage_id' => $passage->id,
        'start_offset' => 4, 'end_offset' => 13, // "the quick"
        'part' => 1,
    ]);

    return ['work' => $work, 'layer' => $layer, 'passage' => $passage];
}

/** Each column's readings for one layer, resolved to words against its text. */
function layerColumnTexts(CanonicalPassage $passage, TranscriptionLayer $layer): array
{
    return Lemma::where('canonical_passage_id', $passage->id)
        ->orderBy('position')
        ->with('readings')
        ->get()
        ->map(fn (Lemma $lemma) => $lemma->readings
            ->filter(fn (LemmaReading $reading) => $reading->transcription_layer_id === $layer->id)
            ->map(fn (LemmaReading $reading) => mb_substr($layer->text, $reading->start_offset, $reading->end_offset - $reading->start_offset))
            ->values()->all())
        ->values()->all();
}

test('citing a passage a second time in one layer adds another part, reading last by default', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'passage' => $passage] = splitCitationSetup();

    $response = $this->post(route('transcription-segments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3, // "fox"
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();

    $parts = $layer->segments()->where('canonical_passage_id', $passage->id)->inPartOrder()->get();
    expect($parts)->toHaveCount(2)
        ->and($parts[0]->start_offset)->toBe(4) // "the quick" still reads first
        ->and($parts[1]->start_offset)->toBe(0) // "fox" reads last despite standing first
        ->and($parts->pluck('part')->all())->toBe([1, 2]);
});

test('after_part inserts a part into the content order and renumbers the rest', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create();
    $layer = TranscriptionLayer::factory()->create(['text' => "fox\nthe quick"]);
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1',
    ]);
    $first = $layer->segments()->create(['canonical_passage_id' => $passage->id, 'start_offset' => 4, 'end_offset' => 7, 'part' => 1]); // "the"
    $second = $layer->segments()->create(['canonical_passage_id' => $passage->id, 'start_offset' => 8, 'end_offset' => 13, 'part' => 2]); // "quick"

    $response = $this->post(route('transcription-segments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3, // "fox", to read FIRST
        'work_id' => $work->id,
        'label' => '1.1',
        'after_part' => 0,
    ]);

    $response->assertRedirect();

    $parts = $layer->segments()->where('canonical_passage_id', $passage->id)->inPartOrder()->get();
    expect($parts->pluck('start_offset')->all())->toBe([0, 4, 8])
        ->and($parts->pluck('part')->all())->toBe([1, 2, 3])
        ->and($first->fresh()->part)->toBe(2)
        ->and($second->fresh()->part)->toBe(3);
});

test('a late part on an already-collated passage is refused until acknowledged', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'passage' => $passage] = splitCitationSetup();
    PassageAligner::alignWitness($passage, $layer->segments()->get());

    $response = $this->post(route('transcription-segments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertInvalid(['acknowledge_realignment']);
    expect($layer->segments()->count())->toBe(1)
        ->and(PassageAligner::layerReadings($passage, $layer))->toHaveCount(2); // untouched
});

test('an acknowledged late part re-collates the layer from all its parts', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'passage' => $passage] = splitCitationSetup();
    PassageAligner::alignWitness($passage, $layer->segments()->get());

    $response = $this->post(route('transcription-segments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
        'acknowledge_realignment' => true,
    ]);

    $response->assertRedirect();
    $response->assertSessionHasNoErrors();

    // The apparatus now carries the passage's full text in content order —
    // the transposed "fox" included, after the words it follows in reading.
    expect(layerColumnTexts($passage, $layer))->toBe([['the'], ['quick'], ['fox']])
        ->and($layer->segments()->where('canonical_passage_id', $passage->id)->count())->toBe(2);
});

test('a late part whose readings an edition selects keeps them and flags every part for review', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'passage' => $passage] = splitCitationSetup();
    PassageAligner::alignWitness($passage, $layer->segments()->get());

    $lemma = Lemma::where('canonical_passage_id', $passage->id)->orderBy('position')->with('readings')->first();
    $selection = EditionLemma::create([
        'edition_id' => Edition::factory()->for($work)->create()->id,
        'lemma_id' => $lemma->id,
        'selected_reading_id' => $lemma->readings->first()->id,
    ]);
    $readingIdsBefore = PassageAligner::layerReadings($passage, $layer)->pluck('id')->sort()->values()->all();

    $response = $this->post(route('transcription-segments.store', $layer), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
        'acknowledge_realignment' => true,
    ]);

    $response->assertRedirect();
    $response->assertSessionHasNoErrors();

    $parts = $layer->segments()->where('canonical_passage_id', $passage->id)->get();
    expect($parts)->toHaveCount(2)
        ->and($parts->every(fn ($part) => $part->needs_review))->toBeTrue()
        // The edition's decision and the readings it rests on both survive.
        ->and(PassageAligner::layerReadings($passage, $layer)->pluck('id')->sort()->values()->all())->toBe($readingIdsBefore)
        ->and(EditionLemma::whereKey($selection->id)->exists())->toBeTrue();
});

test('re-citing a segment into a passage its layer already cites makes it a part of that passage', function () {
    $this->actingAs(User::factory()->editor()->create());
    ['work' => $work, 'layer' => $layer, 'passage' => $passage] = splitCitationSetup();
    $other = CanonicalPassage::factory()->for($work)->create([
        'address' => ['book' => 1, 'line' => 2], 'sort_key' => '00000001.00000002', 'label' => '1.2',
    ]);
    $stray = $layer->segments()->create(['canonical_passage_id' => $other->id, 'start_offset' => 0, 'end_offset' => 3, 'part' => 1]);

    $response = $this->patch(route('transcription-segments.assign', $stray), [
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();
    expect($stray->fresh()->canonical_passage_id)->toBe($passage->id)
        ->and($stray->fresh()->part)->toBe(2);
});
