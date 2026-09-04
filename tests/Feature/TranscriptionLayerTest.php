<?php

use App\Enums\Layer;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;

/** Cite a passage from a transcription at the given span. */
function citeLayer(TranscriptionLayer $transcription, CanonicalPassage $passage, string $text): TranscriptionSegment
{
    return TranscriptionSegment::factory()->for($transcription)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => mb_strlen($text)]);
}

test('a diplomatic transcription citing the passage is not collated', function () {
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $normalized = TranscriptionLayer::factory()->normalized()->create(['text' => 'the quick fox']);
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'THE QVICK FOX']);
    $segment = citeLayer($normalized, $passage, 'the quick fox');
    citeLayer($diplomatic, $passage, 'THE QVICK FOX');

    PassageAdder::add($edition, $segment, 1.0);

    expect(LemmaReading::where('transcription_layer_id', $diplomatic->id)->exists())->toBeFalse()
        ->and(LemmaReading::where('transcription_layer_id', $normalized->id)->count())->toBe(3);
});

test('both layers of one witness collate as one witness, not two', function () {
    // The bug this feature exists to prevent: a fork copies citation spans
    // verbatim, so without the layer filter a manuscript would appear in its
    // own apparatus disagreeing with itself over its own orthography.
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();
    $witness = Witness::factory()->create();

    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($witness)->create(['text' => 'τοσουτοι μεν ουν']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($witness)
        ->create(['text' => 'τοσοῦτοι μὲν οὖν', 'copied_from_id' => $diplomatic->id]);

    citeLayer($diplomatic, $passage, 'τοσουτοι μεν ουν');
    $segment = citeLayer($normalized, $passage, 'τοσοῦτοι μὲν οὖν');

    PassageAdder::add($edition, $segment, 1.0);

    $lemmas = Lemma::where('canonical_passage_id', $passage->id)->with('readings')->get();

    expect($lemmas)->toHaveCount(3);

    foreach ($lemmas as $lemma) {
        expect($lemma->readings)->toHaveCount(1);
    }
});

test('an edition base must be a normalized transcription', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'the quick fox']);
    citeLayer($diplomatic, $passage, 'the quick fox');

    $this->post(route('edition-passages.store', $edition), [
        'transcription_layer_id' => $diplomatic->id,
        'start_offset' => 0,
        'end_offset' => 13,
    ])->assertInvalid(['transcription_layer_id']);
});

test('a bulk range add rejects a diplomatic transcription', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'the quick fox']);
    citeLayer($diplomatic, $passage, 'the quick fox');

    $this->post(route('edition-passages.store-bulk', $edition), [
        'transcription_layer_id' => $diplomatic->id,
        'from_canonical_passage_id' => $passage->id,
        'to_canonical_passage_id' => $passage->id,
    ])->assertInvalid(['transcription_layer_id']);
});

test('the add-text panel only offers collatable transcriptions', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $edition = Edition::factory()->for($work)->create();

    $normalized = TranscriptionLayer::factory()->normalized()->create(['text' => 'the quick fox']);
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->create(['text' => 'THE QVICK FOX']);
    citeLayer($normalized, $passage, 'the quick fox');
    citeLayer($diplomatic, $passage, 'THE QVICK FOX');

    $this->get(route('editions.show', [$work, $edition]))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('transcriptions', fn ($transcriptions) => collect($transcriptions)->pluck('id')->all() === [$normalized->id])
        );
});
