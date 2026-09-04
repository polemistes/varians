<?php

use App\Models\ManuscriptPage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;

/**
 * The witness page is the workbench: the diplomatic layer always on the
 * left, the normalized always on the right (each pane can also show the
 * facsimile, client-side). Which TRANSCRIPT is open is in the URL, because
 * the server has to load each layer's segments, regions and breaks.
 */

/**
 * @param  array<string, mixed>  $query
 * @return array<string, mixed>
 */
function workbench(Witness $witness, array $query = []): array
{
    return test()->get(route('witnesses.show', ['witness' => $witness, ...$query]))
        ->viewData('page')['props'];
}

test('a witness with one transcription opens straight into it', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $layer = TranscriptionLayer::factory()->for($witness)->diplomatic()
        ->create(['text' => 'ΑΛΦΑ']);

    $props = workbench($witness);

    // Nothing to choose, so nothing is asked: the pane is already open.
    expect($props['leftPane']['layer']['id'])->toBe($layer->id)
        ->and($props['rightPane']['view'])->toBe('facsimile')
        ->and($props['transcripts'])->toHaveCount(1);
});

test('a witness with no transcription still renders, with nothing open', function () {
    $this->actingAs(User::factory()->editor()->create());

    $props = workbench(Witness::factory()->create());

    expect($props['leftPane']['layer'])->toBeNull()
        ->and($props['transcripts'])->toHaveCount(0);
});

test('the transcription asked for is the one opened', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->diplomatic()->create(['text' => 'first']);
    $second = Transcription::factory()->for($witness)->create(['name' => 'Scholia', 'position' => 2]);
    TranscriptionLayer::factory()->for($second)->diplomatic()->create(['text' => 'second']);

    $props = workbench($witness, ['transcription' => $second->id]);

    expect($props['leftPane']['layer']['text'])->toBe('second')
        ->and($props['transcripts'])->toHaveCount(2);
});

test('the layers take their fixed sides: diplomatic left, normalized right', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $transcription = Transcription::factory()->for($witness)->create();
    // Empty diplomatic, filled normalized — the sides do not depend on
    // where the text happens to be.
    TranscriptionLayer::factory()->for($transcription)->diplomatic()->create(['text' => '']);
    TranscriptionLayer::factory()->for($transcription)->normalized()->create(['text' => 'imported']);

    $props = workbench($witness);

    expect($props['leftPane']['layer']['layer'])->toBe('diplomatic')
        ->and($props['rightPane']['layer']['layer'])->toBe('normalized')
        ->and($props['rightPane']['layer']['text'])->toBe('imported');
});

test('the transcript query parameter selects the transcript', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->diplomatic()->create(['text' => 'first']);
    $second = Transcription::factory()->for($witness)->create(['name' => 'Scholia', 'position' => 2]);
    TranscriptionLayer::factory()->for($second)->diplomatic()->create(['text' => 'second']);

    expect(workbench($witness, ['transcript' => $second->id])['leftPane']['layer']['text'])->toBe('second');
});

test('the transcription\'s page division comes with the open layer', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $layer = TranscriptionLayer::factory()->for($witness)->diplomatic()
        ->create(['text' => "page one\npage two"]);
    $layer->transcription->pageBreaks()->create([
        'manuscript_page_id' => ManuscriptPage::factory()->create()->id,
        'start_line' => 1,
    ]);

    // A pane slices its text by these, so without them it could not show
    // one page at a time. They ride in the pane payload because the
    // division belongs to the transcript, not to either layer.
    expect(workbench($witness)['leftPane']['pageBreaks'])->toHaveCount(1);
});

test('a draft transcription is not offered to a reader', function () {
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->diplomatic()->published()->create();
    $draft = Transcription::factory()->for($witness)->create(['name' => 'Unfinished']);
    TranscriptionLayer::factory()->for($draft)->diplomatic()->create();

    $this->actingAs(User::factory()->create());
    expect(workbench($witness)['transcripts'])->toHaveCount(1);

    $this->actingAs(User::factory()->editor()->create());
    expect(workbench($witness)['transcripts'])->toHaveCount(2);
});

test('the old per-transcription URL lands on the witness, at that layer', function () {
    $this->actingAs(User::factory()->editor()->create());
    $layer = TranscriptionLayer::factory()->diplomatic()->create();

    $this->get(route('transcriptions.show', $layer))
        ->assertRedirect(route('witnesses.show', [
            'witness' => $layer->transcription->witness_id,
            'transcription' => $layer->transcription_id,
            'layer' => 'diplomatic',
        ]));
});

test('a legacy pane URL still lands on the layer\'s transcript, sides fixed', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->diplomatic()->create(['text' => 'first']);
    $second = Transcription::factory()->for($witness)->create(['name' => 'Scholia', 'position' => 2]);
    $diplomatic = TranscriptionLayer::factory()->for($second)->diplomatic()->create(['text' => 'ΑΛΦΑ']);
    $normalized = TranscriptionLayer::factory()->for($second)->normalized()->create(['text' => 'ἄλφα']);

    // An old bookmark named a layer per pane; the layer's transcript is the
    // one meant, and the sides are no longer a choice.
    $props = workbench($witness, ['left' => "layer-{$normalized->id}"]);

    expect($props['leftPane']['layer']['id'])->toBe($diplomatic->id)
        ->and($props['rightPane']['layer']['id'])->toBe($normalized->id);
});
