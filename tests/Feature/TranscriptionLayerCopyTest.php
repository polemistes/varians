<?php

use App\Enums\TranscriptionLayer;
use App\Enums\Visibility;
use App\Enums\WitnessType;
use App\Models\CanonicalPassage;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;

test('forking a transcription copies its text and citation spans to a new witness', function () {
    $this->actingAs(User::factory()->editor()->create());
    $work = Work::factory()->create();
    $sourceWitness = Witness::factory()->create(['type' => WitnessType::PrintedEdition]);
    $targetWitness = Witness::factory()->create(['type' => WitnessType::Manuscript]);

    $transcription = Transcription::factory()->for($sourceWitness, 'witness')->create(['text' => 'original text']);
    $passage = CanonicalPassage::factory()->for($work)->create();
    TranscriptionSegment::factory()
        ->for($transcription)
        ->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 8]);

    $response = $this->post(route('transcriptions.fork.store', $transcription), [
        'witness_id' => $targetWitness->id,
        'layer' => TranscriptionLayer::Normalized->value,
    ]);

    $response->assertRedirect();

    $fork = Transcription::where('id', '!=', $transcription->id)->sole();

    expect($fork->witness_id)->toBe($targetWitness->id)
        ->and($fork->forked_from_id)->toBe($transcription->id)
        ->and($fork->text)->toBe('original text')
        ->and($fork->segments)->toHaveCount(1)
        ->and($fork->segments->first()->start_offset)->toBe(0)
        ->and($fork->segments->first()->end_offset)->toBe(8)
        ->and($fork->segments->first()->canonical_passage_id)->toBe($passage->id);
});

test('forking does not copy image-alignment regions — a different witness means different images', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create(['text' => 'original text']);
    TranscriptionRegion::factory()->for($transcription)->create();
    $targetWitness = Witness::factory()->create();

    $this->post(route('transcriptions.fork.store', $transcription), [
        'witness_id' => $targetWitness->id,
        'layer' => TranscriptionLayer::Normalized->value,
    ]);

    $fork = Transcription::where('id', '!=', $transcription->id)->sole();

    expect($fork->regions)->toBeEmpty();
});

test('a fork cannot target a witness that does not exist', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create();

    $response = $this->post(route('transcriptions.fork.store', $transcription), [
        'witness_id' => 999999,
        'layer' => TranscriptionLayer::Normalized->value,
    ]);

    $response->assertInvalid(['witness_id']);
});

test('a transcription can be forked onto a witness unrelated to any of its segments\' works', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create();
    $unrelatedWitness = Witness::factory()->create();

    $response = $this->post(route('transcriptions.fork.store', $transcription), [
        'witness_id' => $unrelatedWitness->id,
        'layer' => TranscriptionLayer::Normalized->value,
    ]);

    $response->assertRedirect();
    expect(Transcription::where('witness_id', $unrelatedWitness->id)->exists())->toBeTrue();
});

test('an editor can fork another editor\'s draft transcription — editing here is fully collaborative', function () {
    $this->actingAs(User::factory()->editor()->create());
    $author = User::factory()->editor()->create();
    $transcription = Transcription::factory()->for($author)->create(['visibility' => Visibility::Draft]);
    $targetWitness = Witness::factory()->create();

    $response = $this->post(route('transcriptions.fork.store', $transcription), [
        'witness_id' => $targetWitness->id,
        'layer' => TranscriptionLayer::Normalized->value,
    ]);

    $response->assertRedirect();
    expect(Transcription::where('witness_id', $targetWitness->id)->exists())->toBeTrue();
});

test('a guest cannot fork a transcription', function () {
    $this->actingAs(User::factory()->create());
    $transcription = Transcription::factory()->published()->create();
    $targetWitness = Witness::factory()->create();

    $response = $this->post(route('transcriptions.fork.store', $transcription), [
        'witness_id' => $targetWitness->id,
        'layer' => TranscriptionLayer::Normalized->value,
    ]);

    $response->assertForbidden();
});
