<?php

use App\Models\CanonicalPassage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;

/**
 * Moving text around in one layer moves the corresponding text in the other:
 * the layers share a word skeleton (same words, same lines — normalization
 * only changes characters within a word), so a whole-word relocation is
 * replayed on the sibling with its own spellings, citations and all.
 */
function twoLayerTranscription(): array
{
    $transcription = Transcription::factory()->create();
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)
        ->create(['text' => "γίνεται πάντα\nκατ᾽ ἔριν"]);
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)
        ->create(['text' => "γιγνεται παντα\nκατ εριν"]);

    return [$normalized, $diplomatic];
}

test('relocating whole words in one layer moves the same words in the other, citations included', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$normalized, $diplomatic] = twoLayerTranscription();

    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    // "γίνεται" cited in the normalized layer, "γιγνεται" in the diplomatic.
    TranscriptionSegment::factory()->for($normalized)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 7]);
    $diplomaticSegment = TranscriptionSegment::factory()->for($diplomatic)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 8]);

    // Move "γίνεται " to the very end of the normalized text.
    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [
            ['start' => 0, 'end' => 8, 'text' => '', 'cut_id' => 'mv1'],
            ['start' => 15, 'end' => 15, 'text' => 'γίνεται ', 'cut_id' => 'mv1'],
        ],
        'text' => "πάντα\nκατ᾽ ἔρινγίνεται ",
    ])->assertRedirect()
        ->assertSessionHas('message', 'Also moved the corresponding text in the diplomatic layer.');

    // The diplomatic layer moved its own spelling of the same words…
    expect($diplomatic->fresh()->text)->toBe("παντα\nκατ ερινγιγνεται ");

    // …and its citation travelled with the move, unflagged.
    $moved = $diplomaticSegment->fresh();
    expect(mb_substr($diplomatic->fresh()->text, $moved->start_offset, $moved->end_offset - $moved->start_offset))
        ->toBe('γιγνεται')
        ->and($moved->needs_review)->toBeFalse();
});

test('page breaks move once, not once per layer', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$normalized, $diplomatic] = twoLayerTranscription();

    // The second line's page. Moving the first line's words to the end
    // dissolves line one into line… the break must follow the text once.
    $break = TranscriptionPageBreak::factory()->for($normalized->transcription)
        ->create(['start_line' => 1]);

    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [
            ['start' => 0, 'end' => 8, 'text' => '', 'cut_id' => 'mv1'],
            ['start' => 15, 'end' => 15, 'text' => 'γίνεται ', 'cut_id' => 'mv1'],
        ],
        'text' => "πάντα\nκατ᾽ ἔρινγίνεται ",
    ])->assertRedirect();

    expect($break->fresh()->start_line)->toBe(1);
});

test('an unmirrorable relocation leaves the other layer alone and the divergence indicator tells', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$normalized, $diplomatic] = twoLayerTranscription();

    // Cut "γίνεται " but paste it mid-word into κατ᾽ — no word boundary.
    $cutText = 'γίνεται ';
    $afterCut = "πάντα\nκατ᾽ ἔριν";
    $pasteAt = 8; // inside "κατ᾽"

    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [
            ['start' => 0, 'end' => 8, 'text' => '', 'cut_id' => 'mv1'],
            ['start' => $pasteAt, 'end' => $pasteAt, 'text' => $cutText, 'cut_id' => 'mv1'],
        ],
        'text' => mb_substr($afterCut, 0, $pasteAt).$cutText.mb_substr($afterCut, $pasteAt),
    ])->assertRedirect()
        ->assertSessionMissing('message');

    expect($diplomatic->fresh()->text)->toBe("γιγνεται παντα\nκατ εριν");
});

test('the witness page reports whether the layers are in step', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$normalized, $diplomatic] = twoLayerTranscription();

    $witness = $normalized->transcription->witness;

    $this->get(route('witnesses.show', [
        'witness' => $witness,
        'transcription' => $normalized->transcription_id,
        'layer' => 'normalized',
    ]))->assertInertia(
        fn ($page) => $page->where('leftPane.correspondence.sibling', 'diplomatic')
            // The sibling's text rides along, for the side-by-side view.
            ->where('leftPane.correspondence.text', "γιγνεται παντα\nκατ εριν")
            ->where('leftPane.correspondence.divergence', null)
    );

    $diplomatic->update(['text' => "γιγνεται παντα εξτρα\nκατ εριν"]);

    $this->get(route('witnesses.show', [
        'witness' => $witness,
        'transcription' => $normalized->transcription_id,
        'layer' => 'normalized',
    ]))->assertInertia(
        fn ($page) => $page->where('leftPane.correspondence.divergence.line', 1)
            ->where('leftPane.correspondence.divergence.a_words', 2)
            ->where('leftPane.correspondence.divergence.b_words', 3)
    );
});

test('an atomic whole-word insertion appears verbatim in the sibling layer', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$normalized, $diplomatic] = twoLayerTranscription();

    // Paste " ῥει" at the very end — a whole-gesture edit.
    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [
            ['start' => 23, 'end' => 23, 'text' => ' ῥει', 'atomic' => true],
        ],
        'text' => "γίνεται πάντα\nκατ᾽ ἔριν ῥει",
    ])->assertRedirect()
        ->assertSessionHas('message', 'Also applied the edit to the diplomatic layer.');

    expect($diplomatic->fresh()->text)->toBe("γιγνεται παντα\nκατ εριν ῥει");
});

test('typing stays in its own layer — the first keystroke of a spelling change must', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$normalized, $diplomatic] = twoLayerTranscription();

    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [
            ['start' => 0, 'end' => 1, 'text' => ''],
        ],
        'text' => "ίνεται πάντα\nκατ᾽ ἔριν",
    ])->assertRedirect()
        ->assertSessionMissing('message');

    expect($diplomatic->fresh()->text)->toBe("γιγνεται παντα\nκατ εριν");
});

test('importing into one empty layer fills the empty sibling too', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)->create(['text' => '']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => '']);

    // Two empty texts are trivially in step — the import bootstraps both.
    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [
            ['start' => 0, 'end' => 0, 'text' => "ΜΗΝΙΝ ΑΕΙΔΕ\nΘΕΑ", 'atomic' => true],
        ],
        'text' => "ΜΗΝΙΝ ΑΕΙΔΕ\nΘΕΑ",
    ])->assertRedirect()
        ->assertSessionHas('message', 'Also applied the edit to the normalized layer.');

    expect($normalized->fresh()->text)->toBe("ΜΗΝΙΝ ΑΕΙΔΕ\nΘΕΑ");
});

test('a refused mirror says so instead of staying silent', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$normalized, $diplomatic] = twoLayerTranscription();
    $diplomatic->update(['text' => 'γιγνεται']); // out of step

    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [
            ['start' => 23, 'end' => 23, 'text' => ' ῥει', 'atomic' => true],
        ],
        'text' => "γίνεται πάντα\nκατ᾽ ἔριν ῥει",
    ])->assertRedirect()
        ->assertSessionHas('message', 'The diplomatic layer was left untouched — the layers are out of step (see the indicator by the layer buttons).');

    expect($diplomatic->fresh()->text)->toBe('γιγνεται');
});

test('mirroring can be switched off — the sibling is left entirely alone', function () {
    $this->actingAs(User::factory()->editor()->create());
    $transcription = Transcription::factory()->create();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)->create(['text' => '']);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)->create(['text' => '']);

    // The bootstrapping flow: each layer gets its own text from elsewhere.
    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [
            ['start' => 0, 'end' => 0, 'text' => 'γίνεται πάντα', 'atomic' => true],
        ],
        'text' => 'γίνεται πάντα',
        'mirror' => false,
    ])->assertRedirect()
        ->assertSessionMissing('message');

    expect($diplomatic->fresh()->text)->toBe('');

    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [
            ['start' => 0, 'end' => 0, 'text' => 'γιγνεται παντα', 'atomic' => true],
        ],
        'text' => 'γιγνεται παντα',
        'mirror' => false,
    ])->assertRedirect();

    expect($normalized->fresh()->text)->toBe('γίνεται πάντα')
        ->and($diplomatic->fresh()->text)->toBe('γιγνεται παντα');
});
