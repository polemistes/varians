<?php

use App\Models\CanonicalPassage;
use App\Models\ReferenceScheme;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use App\Support\Transcription\CitationIntegrity;

test('marking a span requires a citation — there is no unassigned state', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);

    $response = $this->post(route('transcription-segments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
    ]);

    $response->assertInvalid(['work_id', 'label']);
    expect($transcription->segments()->count())->toBe(0);
});

test('marking a span creates it already cited, in one step', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $response = $this->post(route('transcription-segments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();

    $segment = $transcription->segments()->sole();
    expect($segment->canonicalPassage->work_id)->toBe($work->id)
        ->and($segment->canonicalPassage->label)->toBe('1.1')
        ->and($work->relatedWitnesses()->whereKey($transcription->transcription->witness_id)->exists())->toBeTrue();
});

test('a segment can be cited with an alphanumeric line label like "4a"', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = TranscriptionLayer::factory()->create(['text' => 'the quick brown fox']);
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();

    $response = $this->post(route('transcription-segments.store', $transcription), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.4a',
    ]);

    $response->assertRedirect();

    $segment = $transcription->segments()->sole();
    expect($segment->canonicalPassage->label)->toBe('1.4a')
        ->and($segment->canonicalPassage->address)->toBe(['book' => 1, 'line' => '4a']);
});

test('an alphanumeric line label sorts between its numeric neighbours', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $four = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 4], 'sort_key' => '00000001.00000004', 'label' => '1.4']);
    $five = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 5], 'sort_key' => '00000001.00000005', 'label' => '1.5']);
    $segment = TranscriptionSegment::factory()->create();

    $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => '1.4a',
    ]);

    $fourA = $segment->fresh()->canonicalPassage;
    expect(strcmp($four->sort_key, $fourA->sort_key))->toBeLessThan(0)
        ->and(strcmp($fourA->sort_key, $five->sort_key))->toBeLessThan(0);
});

test('a segment can be re-cited to a different work, creating the canonical passage', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $segment = TranscriptionSegment::factory()->create();

    $response = $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    $response->assertRedirect();

    $segment->refresh();
    expect($segment->canonicalPassage)->not->toBeNull()
        ->and($segment->canonicalPassage->work_id)->toBe($work->id)
        ->and($segment->canonicalPassage->label)->toBe('1.1')
        ->and($work->relatedWitnesses()->whereKey($segment->transcriptionLayer->transcription->witness_id)->exists())->toBeTrue();
});

test('re-citing a segment reuses an existing canonical passage for the same citation', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $passage = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $segment = TranscriptionSegment::factory()->create();

    $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => '1.1',
    ]);

    expect($segment->fresh()->canonical_passage_id)->toBe($passage->id)
        ->and($work->canonicalPassages()->count())->toBe(1);
});

test('a segment\'s citation cannot be cleared — a work_id is always required', function () {
    $this->actingAs(User::factory()->editor()->create());
    $passage = CanonicalPassage::factory()->create();
    $segment = TranscriptionSegment::factory()->for($passage, 'canonicalPassage')->create();

    $response = $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => null,
    ]);

    $response->assertInvalid(['work_id']);
    expect($segment->fresh()->canonical_passage_id)->toBe($passage->id);
});

test('assigning a citation that does not match the work\'s numbering scheme fails', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $segment = TranscriptionSegment::factory()->create();
    $originalPassageId = $segment->canonical_passage_id;

    $response = $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => 'not-a-valid-citation!!',
    ]);

    $response->assertInvalid(['label']);
    expect($segment->fresh()->canonical_passage_id)->toBe($originalPassageId);
});

test('a work another transcript of the same witness already holds cannot be cited here', function () {
    // One transcript per witness per work (user decision): the witness's
    // text of a work is cited in one of its transcripts, whole.
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create(['siglum' => 'R']);
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create(['title' => 'Lysistrata']);
    $passage = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);

    $first = Transcription::factory()->for($witness)->create(['name' => 'First']);
    $firstLayer = TranscriptionLayer::factory()->normalized()->for($first)->create(['text' => 'the quick fox']);
    TranscriptionSegment::factory()->for($firstLayer)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 3]);

    $second = Transcription::factory()->for($witness)->create(['name' => 'Second']);
    $secondLayer = TranscriptionLayer::factory()->normalized()->for($second)->create(['text' => 'the quick fox']);

    $this->post(route('transcription-segments.store', $secondLayer), [
        'start_offset' => 0,
        'end_offset' => 3,
        'work_id' => $work->id,
        'label' => '1.2',
    ])->assertInvalid(['work_id']);

    expect($secondLayer->segments()->count())->toBe(0);

    // Re-citing a span of the second transcript to the work is refused too.
    $other = Work::factory()->for($scheme, 'referenceScheme')->create(['title' => 'Other']);
    $otherPassage = CanonicalPassage::factory()->for($other)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $segment = TranscriptionSegment::factory()->for($secondLayer)->for($otherPassage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 3]);

    $this->patch(route('transcription-segments.assign', $segment), [
        'work_id' => $work->id,
        'label' => '1.1',
    ])->assertInvalid(['work_id']);

    // The same transcript may go on citing the work, and another witness
    // is free to hold it.
    $this->post(route('transcription-segments.store', $firstLayer), [
        'start_offset' => 4,
        'end_offset' => 9,
        'work_id' => $work->id,
        'label' => '1.2',
    ])->assertRedirect();
});

test('the ownership check lists a witness holding one work in two transcripts, and passes when clean', function () {
    $this->artisan('witnesses:check-work-ownership')->assertExitCode(0);

    $witness = Witness::factory()->create(['siglum' => 'R']);
    $work = Work::factory()->for(ReferenceScheme::factory(), 'referenceScheme')->create(['title' => 'Lysistrata']);
    $passage = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);

    foreach (['First', 'Second'] as $name) {
        $layer = TranscriptionLayer::factory()->normalized()
            ->for(Transcription::factory()->for($witness)->create(['name' => $name]))
            ->create(['text' => 'the quick fox']);
        TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 3]);
    }

    $this->artisan('witnesses:check-work-ownership')
        ->expectsOutputToContain('R holds Lysistrata in 2 transcripts')
        ->assertExitCode(1);
});

test('the citation check reports spans that drifted off their words, and passes when clean', function () {
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $one = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $two = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 2], 'sort_key' => '00000001.00000002', 'label' => '1.2']);
    $layer = TranscriptionLayer::factory()->create(['text' => "the quick fox\nline two"]);
    TranscriptionSegment::factory()->for($layer)->for($one, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);
    $second = TranscriptionSegment::factory()->for($layer)->for($two, 'canonicalPassage')->create(['start_offset' => 14, 'end_offset' => 22]);

    $this->artisan('transcriptions:check-citations')->assertExitCode(0);

    // Slid one character left: it now begins on the newline and ends a
    // letter short — the shape a drifted span takes.
    $second->update(['start_offset' => 13, 'end_offset' => 21]);

    $this->artisan('transcriptions:check-citations')
        ->expectsOutputToContain('(1.2) ends inside a word')
        ->assertExitCode(1);
});

test('a span that slips off its words is flagged at the save that did it, and unflagged when it is back', function () {
    $this->actingAs(User::factory()->editor()->create());
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $one = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 1], 'sort_key' => '00000001.00000001', 'label' => '1.1']);
    $two = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 2], 'sort_key' => '00000001.00000002', 'label' => '1.2']);
    $layer = TranscriptionLayer::factory()->normalized()->create(['text' => "the fox\nline two"]);
    $first = TranscriptionSegment::factory()->for($layer)->for($one, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 7]);
    $second = TranscriptionSegment::factory()->for($layer)->for($two, 'canonicalPassage')->create(['start_offset' => 8, 'end_offset' => 16]);

    // Deleting "x⏎li" glues "fo" to "ne": 1.1 now ends inside a word and
    // 1.2 begins inside one — but they meet exactly there, as two lines
    // pasted flush together do, so neither is flagged for its bounds.
    $this->patch(route('transcriptions.text.update', $layer), [
        'ops' => [['start' => 6, 'end' => 10, 'text' => '']],
        'text' => 'the fone two',
    ])->assertRedirect();

    expect($first->fresh()->boundary_review)->toBeFalse()
        ->and($second->fresh()->boundary_review)->toBeFalse();

    // A span slid one character by hand — the shape drift takes: it begins
    // on the space before its word and ends a letter short.
    $second->update(['start_offset' => 6, 'end_offset' => 11]);
    $first->update(['end_offset' => 5]);

    $this->patch(route('transcriptions.text.update', $layer), [
        'ops' => [['start' => 12, 'end' => 12, 'text' => '!']],
        'text' => 'the fone two!',
    ])->assertRedirect();

    expect($second->fresh()->boundary_review)->toBeTrue()
        ->and($first->fresh()->boundary_review)->toBeTrue()
        ->and(CitationIntegrity::issues($layer->fresh()))
        ->toBe(['#'.$first->id.' (1.1) ends inside a word', '#'.$second->id.' (1.2) begins inside a word', '#'.$second->id.' (1.2) ends inside a word']);

    // Re-cited on their words, the flags go by themselves.
    $second->update(['start_offset' => 9, 'end_offset' => 13]);
    $first->update(['end_offset' => 8]);
    $this->patch(route('transcriptions.text.update', $layer), [
        'ops' => [['start' => 13, 'end' => 13, 'text' => ' ?']],
        'text' => 'the fone two! ?',
    ])->assertRedirect();

    expect($second->fresh()->boundary_review)->toBeFalse()
        ->and($first->fresh()->boundary_review)->toBeFalse();
});

test('the citation check can flag drifted spans in place', function () {
    $scheme = ReferenceScheme::factory()->create();
    $work = Work::factory()->for($scheme, 'referenceScheme')->create();
    $two = CanonicalPassage::factory()->for($work)->create(['address' => ['book' => 1, 'line' => 2], 'sort_key' => '00000001.00000002', 'label' => '1.2']);
    $layer = TranscriptionLayer::factory()->create(['text' => "the quick fox\nline two"]);
    // Slid one character left: begins on the newline, ends a letter short.
    $drifted = TranscriptionSegment::factory()->for($layer)->for($two, 'canonicalPassage')->create(['start_offset' => 13, 'end_offset' => 21]);

    $this->artisan('transcriptions:check-citations --snap')
        ->expectsOutputToContain('flagged: ends inside a word')
        ->assertExitCode(1);

    expect($drifted->fresh()->boundary_review)->toBeTrue()
        ->and([$drifted->fresh()->start_offset, $drifted->fresh()->end_offset])->toBe([13, 21]);
});
