<?php

use App\Enums\Layer;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Edition\PassageAdder;
use Illuminate\Database\QueryException;

/**
 * A witness may be transcribed more than once. Nothing records what kind of
 * text a transcription holds or which is the principal one: a manuscript can
 * carry texts belonging to different works, or several kinds of text across
 * the same pages, and which one matters depends on the edition being made.
 */
test('a witness can hold several named transcriptions', function () {
    $witness = Witness::factory()->create();

    Transcription::factory()->for($witness)->create(['name' => 'Main text']);
    Transcription::factory()->for($witness)->create(['name' => 'Scholia']);

    expect($witness->transcriptions()->pluck('name')->all())
        ->toBe(['Main text', 'Scholia']);
});

test('each transcription holds its own diplomatic and normalized layer', function () {
    $witness = Witness::factory()->create();

    $first = Transcription::factory()->for($witness)->create();
    TranscriptionLayer::factory()->diplomatic()->for($first)->create(['text' => 'ΑΛΦΑ']);
    TranscriptionLayer::factory()->normalized()->for($first)->create(['text' => 'ἄλφα']);

    $second = Transcription::factory()->for($witness)->create();
    TranscriptionLayer::factory()->diplomatic()->for($second)->create(['text' => 'ΒΗΤΑ']);
    TranscriptionLayer::factory()->normalized()->for($second)->create(['text' => 'βῆτα']);

    expect($first->diplomatic->text)->toBe('ΑΛΦΑ')
        ->and($first->normalized->text)->toBe('ἄλφα')
        ->and($second->diplomatic->text)->toBe('ΒΗΤΑ')
        ->and($second->normalized->text)->toBe('βῆτα')
        ->and($witness->transcriptionLayers()->count())->toBe(4);
});

test('a transcription holds only one layer of each kind', function () {
    $transcription = Transcription::factory()->create();
    TranscriptionLayer::factory()->diplomatic()->for($transcription)->create();

    expect(fn () => TranscriptionLayer::factory()->diplomatic()->for($transcription)->create())
        ->toThrow(QueryException::class);
});

test('a diplomatic counterpart is the sibling layer, not merely one of the same witness', function () {
    $this->actingAs(User::factory()->editor()->create());

    $work = Work::factory()->create();
    $passage = CanonicalPassage::factory()->for($work)->create([
        'address' => ['line' => 1], 'sort_key' => '00000001', 'label' => '1',
    ]);
    $edition = Edition::factory()->for($work)->create();
    $witness = Witness::factory()->create(['siglum' => 'A']);

    // The transcription the edition prints from, with its own two layers.
    $printed = Transcription::factory()->for($witness)->create(['name' => 'Main text']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($printed)->published()
        ->create(['text' => 'ἄλφα']);
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($printed)->published()
        ->create(['text' => 'ΑΛΦΑ']);
    TranscriptionSegment::factory()->for($diplomatic)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);
    $segment = TranscriptionSegment::factory()->for($normalized)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 4]);

    // A second transcription of the same manuscript, whose diplomatic layer
    // says something else entirely. Keyed by witness it could answer for the
    // first; keyed by transcription it cannot.
    $other = Transcription::factory()->for($witness)->create(['name' => 'Scholia']);
    $otherDiplomatic = TranscriptionLayer::factory()->diplomatic()->for($other)->published()
        ->create(['text' => 'ΩΜΕΓΑ']);
    TranscriptionSegment::factory()->for($otherDiplomatic)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5]);

    PassageAdder::add($edition, $segment, 1.0);

    $payload = $this->get(route('editions.show', [$work, $edition]))
        ->viewData('page')['props']['windowPassages'][0];

    expect($payload['base_diplomatic'])->toBe('ΑΛΦΑ');
});

test('publishing a transcription publishes both of its layers', function () {
    $transcription = Transcription::factory()->create();
    TranscriptionLayer::factory()->normalized()->for($transcription)->create();
    TranscriptionLayer::factory()->diplomatic()->for($transcription)->create();

    // Visibility is a property of the transcription, not of a layer. Which
    // layer the editor writes first is how she chooses to work, not a claim
    // that the other is more provisional.
    $reader = User::factory()->create();

    expect(TranscriptionLayer::visibleTo($reader)->whereBelongsTo($transcription)->count())->toBe(0);

    $transcription->update(['visibility' => 'published']);

    expect(TranscriptionLayer::visibleTo($reader)->whereBelongsTo($transcription)->count())->toBe(2);
});
