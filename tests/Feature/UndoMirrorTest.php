<?php

use App\Models\CanonicalPassage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Work;
use Illuminate\Support\Str;

/**
 * The undo/mirror pairings the client's edit history produces: an inverse
 * op is as atomic as the edit it reverses, and carries the sibling's own
 * former words where it re-inserts what a mirrored deletion removed.
 */
function undoMirrorLayers(): array
{
    $transcription = Transcription::factory()->create();
    $diplomatic = TranscriptionLayer::factory()->diplomatic()->for($transcription)
        ->create(['text' => "ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ"]);
    $normalized = TranscriptionLayer::factory()->normalized()->for($transcription)
        ->create(['text' => "μῆνιν ἄειδε θεὰ\nοὐλομένην"]);

    return [$diplomatic, $normalized];
}

test('typing over a selected word is a spelling edit and stays in its layer', function () {
    // The client no longer flags a typed-over selection atomic; the server
    // sees a plain replacement and leaves the sibling alone.
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = undoMirrorLayers();

    $this->patch(route('transcriptions.text.update', $normalized), [
        'ops' => [['start' => 6, 'end' => 11, 'text' => 'α']],
        'text' => "μῆνιν α θεὰ\nοὐλομένην",
    ])->assertRedirect()->assertSessionMissing('message');

    expect($diplomatic->fresh()->text)->toBe("ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ");
});

test('the undo of an unmirrored deletion is not mirrored either', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = undoMirrorLayers();

    // Two letters off the head of ΜΗΝΙΝ: a mid-word edit, not mirrored.
    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [['start' => 0, 'end' => 2, 'text' => '', 'atomic' => true]],
        'text' => "ΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ",
    ])->assertRedirect();
    expect($normalized->fresh()->text)->toBe("μῆνιν ἄειδε θεὰ\nοὐλομένην");

    // Its undo arrives as the history sends it: NOT atomic, because the
    // edit's own end stood inside a word and so could never have mirrored
    // (see TranscriptPane's inverseMirroring). Stamped atomic — the old
    // rule for every undo — the re-insertion at the word boundary mirrored
    // verbatim and glued ΜΗ onto μῆνιν (real bug).
    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [['start' => 0, 'end' => 0, 'text' => 'ΜΗ', 'atomic' => false]],
        'text' => "ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ",
    ])->assertRedirect()->assertSessionMissing('message');

    expect($normalized->fresh()->text)->toBe("μῆνιν ἄειδε θεὰ\nοὐλομένην");
});

test('the undo of a mirrored word deletion gives the sibling its own spelling back', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = undoMirrorLayers();

    // Delete "ΑΕΙΔΕ " in the diplomatic layer — whole words, mirrored.
    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [['start' => 6, 'end' => 12, 'text' => '', 'atomic' => true]],
        'text' => "ΜΗΝΙΝ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ",
    ])->assertRedirect();
    expect($normalized->fresh()->text)->toBe("μῆνιν θεὰ\nοὐλομένην");

    // The undo re-inserts our spelling here and the sibling's there.
    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [['start' => 6, 'end' => 6, 'text' => 'ΑΕΙΔΕ ', 'atomic' => true, 'mirror_text' => 'ἄειδε ']],
        'text' => "ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ",
    ])->assertRedirect();

    expect($normalized->fresh()->text)->toBe("μῆνιν ἄειδε θεὰ\nοὐλομένην");
});

test('undoing a deletion at the head of a cited span puts the span back over the restored words', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = undoMirrorLayers();
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    $group = (string) Str::uuid();
    $segment = TranscriptionSegment::factory()->for($diplomatic)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 15, 'part' => 1, 'group_id' => $group]);
    $counterpart = TranscriptionSegment::factory()->for($normalized)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 15, 'part' => 1, 'group_id' => $group]);

    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [['start' => 0, 'end' => 2, 'text' => '']],
        'text' => "ΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ",
    ])->assertRedirect();

    $this->patch(route('transcriptions.text.update', $diplomatic), [
        'ops' => [['start' => 0, 'end' => 0, 'text' => 'ΜΗ']],
        'text' => "ΜΗΝΙΝ ΑΕΙΔΕ ΘΕΑ\nΟΥΛΟΜΕΝΗΝ",
    ])->assertRedirect();

    // The span's start has right-gravity, so the transform alone leaves
    // the restored letters uncited...
    expect([$segment->fresh()->start_offset, $segment->fresh()->end_offset])->toBe([2, 15]);

    // ...and the history's snapshot puts it back, counterpart included.
    $this->post(route('transcription-spans.restore', $diplomatic), [
        'adjust_segments' => [[
            'id' => $segment->id,
            'start_offset' => 0,
            'end_offset' => 15,
            'needs_review' => false,
        ]],
    ])->assertRedirect();

    expect([$segment->fresh()->start_offset, $segment->fresh()->end_offset])->toBe([0, 15])
        ->and([$counterpart->fresh()->start_offset, $counterpart->fresh()->end_offset])->toBe([0, 15]);
});

test('an adjustment can only name a span of the layer it is posted to', function () {
    $this->actingAs(User::factory()->editor()->create());
    [$diplomatic, $normalized] = undoMirrorLayers();
    $passage = CanonicalPassage::factory()->for(Work::factory())->create();
    $foreign = TranscriptionSegment::factory()->for($normalized)->for($passage, 'canonicalPassage')
        ->create(['start_offset' => 0, 'end_offset' => 5, 'part' => 1]);

    $this->post(route('transcription-spans.restore', $diplomatic), [
        'adjust_segments' => [['id' => $foreign->id, 'start_offset' => 0, 'end_offset' => 15]],
    ])->assertInvalid(['adjust_segments.0.id']);

    expect([$foreign->fresh()->start_offset, $foreign->fresh()->end_offset])->toBe([0, 5]);
});
