<?php

use App\Models\ManuscriptPage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\User;
use App\Models\Witness;

/**
 * The witness page is the workbench: the transcription on the left, the
 * manuscript on the right. Which transcription and which layer are in the URL,
 * because the server has to load that layer's segments, regions and breaks.
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
    expect($props['transcription']['id'])->toBe($layer->id)
        ->and($props['transcriptions'])->toHaveCount(1);
});

test('a witness with no transcription still renders, with nothing open', function () {
    $this->actingAs(User::factory()->editor()->create());

    $props = workbench(Witness::factory()->create());

    expect($props['transcription'])->toBeNull()
        ->and($props['transcriptions'])->toHaveCount(0);
});

test('the transcription asked for is the one opened', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->diplomatic()->create(['text' => 'first']);
    $second = Transcription::factory()->for($witness)->create(['name' => 'Scholia', 'position' => 2]);
    TranscriptionLayer::factory()->for($second)->diplomatic()->create(['text' => 'second']);

    $props = workbench($witness, ['transcription' => $second->id]);

    expect($props['transcription']['text'])->toBe('second')
        ->and($props['transcriptions'])->toHaveCount(2);
});

test('the layer asked for is the one opened', function () {
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $transcription = Transcription::factory()->for($witness)->create();
    TranscriptionLayer::factory()->for($transcription)->diplomatic()->create(['text' => 'ΑΛΦΑ']);
    TranscriptionLayer::factory()->for($transcription)->normalized()->create(['text' => 'ἄλφα']);

    expect(workbench($witness, ['layer' => 'normalized'])['transcription']['text'])->toBe('ἄλφα')
        ->and(workbench($witness, ['layer' => 'diplomatic'])['transcription']['text'])->toBe('ΑΛΦΑ');
});

test('the layer with text is opened by default, whichever it is', function () {
    // Transcribing from the manuscript begins in the diplomatic layer and
    // importing begins in the normalized one, so opening whichever has
    // something in it lands the editor where the work is.
    $this->actingAs(User::factory()->editor()->create());
    $witness = Witness::factory()->create();
    $transcription = Transcription::factory()->for($witness)->create();
    TranscriptionLayer::factory()->for($transcription)->diplomatic()->create(['text' => '']);
    TranscriptionLayer::factory()->for($transcription)->normalized()->create(['text' => 'imported']);

    expect(workbench($witness)['transcription']['layer'])->toBe('normalized');
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

    // The left pane slices the text by these, so without them it could not
    // show one page at a time. They come as their own prop because the
    // division belongs to the transcription, not to either layer.
    expect(workbench($witness)['pageBreaks'])->toHaveCount(1);
});

test('a draft transcription is not offered to a reader', function () {
    $witness = Witness::factory()->create();
    TranscriptionLayer::factory()->for($witness)->diplomatic()->published()->create();
    $draft = Transcription::factory()->for($witness)->create(['name' => 'Unfinished']);
    TranscriptionLayer::factory()->for($draft)->diplomatic()->create();

    $this->actingAs(User::factory()->create());
    expect(workbench($witness)['transcriptions'])->toHaveCount(1);

    $this->actingAs(User::factory()->editor()->create());
    expect(workbench($witness)['transcriptions'])->toHaveCount(2);
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
