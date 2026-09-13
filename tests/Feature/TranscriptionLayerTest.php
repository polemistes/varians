<?php

use App\Enums\Layer;
use App\Models\Assignment;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\SegmentAdder;

/** Assign a segment from a transcription at the given span. */
function assignLayer(TranscriptionLayer $transcription, Segment $segment, string $text): Assignment
{
    return Assignment::factory()->for($transcription)->for($segment, 'segment')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);
}

test('a diplomatic transcription assigning text to the segment is not collated', function () {
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $normalized = TranscriptionLayer::factory()->normalized()->create(['text' => 'the quick fox']);
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'THE QVICK FOX']);
    $assignment = assignLayer($normalized, $segment, 'the quick fox');
    assignLayer($diplomatic, $segment, 'THE QVICK FOX');

    SegmentAdder::add($edition, $assignment, 1.0);

    expect(LemmaReading::where('transcription_layer_id', $diplomatic->id)->exists())->toBeFalse()
        ->and(LemmaReading::where('transcription_layer_id', $normalized->id)->count())->toBe(3);
});

test('both layers of one witness collate as one witness, not two', function () {
    // The bug this feature exists to prevent: a fork copies assignment spans
    // verbatim, so without the layer filter a manuscript would appear in its
    // own apparatus disagreeing with itself over its own orthography.
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();
    $witness = Witness::factory()->create();

    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($witness)->create(['text' => 'τοσουτοι μεν ουν']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($witness)
        ->create(['text' => 'τοσοῦτοι μὲν οὖν', 'copied_from_id' => $diplomatic->id]);

    assignLayer($diplomatic, $segment, 'τοσουτοι μεν ουν');
    $assignment = assignLayer($normalized, $segment, 'τοσοῦτοι μὲν οὖν');

    SegmentAdder::add($edition, $assignment, 1.0);

    $lemmas = Lemma::where('segment_id', $segment->id)->with('readings')->get();

    expect($lemmas)->toHaveCount(3);

    foreach ($lemmas as $lemma) {
        expect($lemma->readings)->toHaveCount(1);
    }
});

test('an edition base must be a normalized transcription', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'the quick fox']);
    assignLayer($diplomatic, $segment, 'the quick fox');

    $this->post(route('edition-segments.store', $edition), [
        'transcription_layer_id' => $diplomatic->id,
        'start_offset' => 0,
        'end_offset' => 13,
    ])->assertInvalid(['transcription_layer_id']);
});

test('a bulk range add rejects a diplomatic transcription', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'the quick fox']);
    assignLayer($diplomatic, $segment, 'the quick fox');

    $this->post(route('edition-segments.store-bulk', $edition), [
        'transcription_layer_id' => $diplomatic->id,
        'from_segment_id' => $segment->id,
        'to_segment_id' => $segment->id,
    ])->assertInvalid(['transcription_layer_id']);
});

test('the add-text panel only offers collatable transcriptions', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $normalized = TranscriptionLayer::factory()->normalized()->create(['text' => 'the quick fox']);
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'THE QVICK FOX']);
    assignLayer($normalized, $segment, 'the quick fox');
    assignLayer($diplomatic, $segment, 'THE QVICK FOX');

    $this->get(route('editions.show', [$work, $edition]))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('transcriptions', fn ($transcriptions) => collect($transcriptions)->pluck('id')->all() === [$normalized->id])
        );
});

test('the add-text panel names each transcript by its witness and its own name', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $segment = Segment::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $witness = Witness::factory()->create(['siglum' => 'R', 'label' => 'Ravennas 429']);
    $transcription = Transcription::factory()->for($witness)->create([
        'name' => 'Main text',
        'visibility' => 'published',
    ]);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => 'the quick fox']);
    assignLayer($normalized, $segment, 'the quick fox');

    $this->get(route('editions.show', [$work, $edition]))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('transcriptions.0.name', 'Main text')
            ->where('transcriptions.0.witness.siglum', 'R')
            ->where('transcriptions.0.witness.label', 'Ravennas 429')
        );
});
