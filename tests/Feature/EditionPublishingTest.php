<?php

use App\Enums\Visibility;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;

/**
 * An owner's draft edition of a work; a witness with one transcription
 * citing the work and another citing nothing; a conjecture on the work
 * and one on another work.
 *
 * @return array{owner: User, work: Work, edition: Edition, witness: Witness, citing: Transcription, other: Transcription, conjecture: Conjecture, foreign: Conjecture}
 */
function draftEditionWithEvidence(): array
{
    $owner = User::factory()->create();
    $work = Work::factory()->for($owner)->create();
    $edition = Edition::factory()->for($owner)->for($work)->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $witness = Witness::factory()->for($owner)->create();

    $citing = Transcription::factory()->for($witness)->create();
    $layer = TranscriptionLayer::factory()->for($citing)->create(['text' => 'the quick fox']);
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);

    $other = Transcription::factory()->for($witness)->create();
    TranscriptionLayer::factory()->for($other)->create(['text' => 'unrelated']);

    $conjecture = Conjecture::factory()->for($owner)->for($passage, 'canonicalPassage')->create();
    $foreign = Conjecture::factory()->for($owner)->create();

    return compact('owner', 'work', 'edition', 'witness', 'citing', 'other', 'conjecture', 'foreign');
}

test('publishing an edition publishes the transcriptions citing its work and the conjectures recorded against it', function () {
    ['owner' => $owner, 'work' => $work, 'edition' => $edition, 'witness' => $witness, 'citing' => $citing, 'other' => $other, 'conjecture' => $conjecture, 'foreign' => $foreign] = draftEditionWithEvidence();

    $this->get(route('witnesses.show', $witness))->assertForbidden();

    $this->actingAs($owner)
        ->patch(route('editions.update', $edition), ['visibility' => 'published'])
        ->assertRedirect();

    expect($edition->fresh()->visibility)->toBe(Visibility::Published)
        ->and($citing->fresh()->visibility)->toBe(Visibility::Published)
        ->and($other->fresh()->visibility)->toBe(Visibility::Draft)
        ->and($conjecture->fresh()->visibility)->toBe(Visibility::Published)
        ->and($foreign->fresh()->visibility)->toBe(Visibility::Draft);

    // Readers can now follow the apparatus back to the manuscript.
    auth()->logout();
    $this->get(route('witnesses.show', $witness))->assertOk();
    $this->get(route('editions.show', [$work, $edition]))->assertOk();
});

test('unpublishing takes the transcriptions and conjectures back — unless another published edition still needs them', function () {
    ['owner' => $owner, 'work' => $work, 'edition' => $edition, 'citing' => $citing, 'conjecture' => $conjecture] = draftEditionWithEvidence();
    $this->actingAs($owner)->patch(route('editions.update', $edition), ['visibility' => 'published']);

    $second = Edition::factory()->for($owner)->for($work)->create();
    $this->patch(route('editions.update', $second), ['visibility' => 'published']);

    $this->patch(route('editions.update', $edition), ['visibility' => 'draft'])->assertRedirect();
    expect($edition->fresh()->visibility)->toBe(Visibility::Draft)
        ->and($citing->fresh()->visibility)->toBe(Visibility::Published)
        ->and($conjecture->fresh()->visibility)->toBe(Visibility::Published);

    $this->patch(route('editions.update', $second), ['visibility' => 'draft'])->assertRedirect();
    expect($citing->fresh()->visibility)->toBe(Visibility::Draft)
        ->and($conjecture->fresh()->visibility)->toBe(Visibility::Draft);
});

test('a transcription of a codex stays public while a published edition of another work it cites needs it', function () {
    ['owner' => $owner, 'edition' => $edition, 'citing' => $citing, 'conjecture' => $conjecture] = draftEditionWithEvidence();

    // The same transcription also cites a second work, with its own
    // published edition.
    $otherWork = Work::factory()->for($owner)->create();
    $otherEdition = Edition::factory()->for($owner)->for($otherWork)->create();
    $otherPassage = CanonicalPassage::factory()->for($otherWork)->create();
    TranscriptionSegment::factory()->for($citing->layers()->first())->for($otherPassage, 'canonicalPassage')->create(['start_offset' => 4, 'end_offset' => 9]);

    $this->actingAs($owner);
    $this->patch(route('editions.update', $edition), ['visibility' => 'published']);
    $this->patch(route('editions.update', $otherEdition), ['visibility' => 'published']);
    $this->patch(route('editions.update', $edition), ['visibility' => 'draft']);

    expect($citing->fresh()->visibility)->toBe(Visibility::Published)
        ->and($conjecture->fresh()->visibility)->toBe(Visibility::Draft);
});

test('only the owner or an administrator publishes — not an invited editor, not a site-wide editor', function () {
    ['owner' => $owner, 'edition' => $edition] = draftEditionWithEvidence();
    $invitee = User::factory()->create();
    $edition->editors()->attach($invitee->id, ['granted_by_id' => $owner->id]);

    $this->actingAs($invitee)->patch(route('editions.update', $edition), ['visibility' => 'published'])->assertForbidden();
    $this->actingAs(User::factory()->editor()->create())->patch(route('editions.update', $edition), ['visibility' => 'published'])->assertForbidden();
    expect($edition->fresh()->visibility)->toBe(Visibility::Draft);

    $this->actingAs(User::factory()->administrator()->create())->patch(route('editions.update', $edition), ['visibility' => 'published'])->assertRedirect();
    expect($edition->fresh()->visibility)->toBe(Visibility::Published);
});

test('a reader sees only published conjectures on the work page; the owner sees all', function () {
    ['owner' => $owner, 'work' => $work, 'conjecture' => $conjecture] = draftEditionWithEvidence();
    $conjecture->update(['visibility' => Visibility::Published]);
    $draft = Conjecture::factory()->for($owner)->for($conjecture->canonicalPassage, 'canonicalPassage')->create();
    // The work is readable because a transcription citing it is published.
    Transcription::query()->update(['visibility' => Visibility::Published->value]);

    $this->get(route('works.show', $work))
        ->assertOk()
        ->assertInertia(fn ($page) => $page->has('conjectures', 1)->where('conjectures.0.id', $conjecture->id));

    $this->actingAs($owner)->get(route('works.show', $work))
        ->assertInertia(fn ($page) => $page->has('conjectures', 2));

    expect($draft->visibility)->toBe(Visibility::Draft);
});

test('a conjecture recorded on a work that already has a published edition is published at once', function () {
    ['owner' => $owner, 'work' => $work, 'edition' => $edition] = draftEditionWithEvidence();
    $passage = $work->canonicalPassages()->sole();

    $this->actingAs($owner);
    $this->post(route('conjectures.store', $passage), ['text' => 'while a draft', 'proposed_by' => 'Bentley'])->assertRedirect();
    expect(Conjecture::where('text', 'while a draft')->sole()->visibility)->toBe(Visibility::Draft);

    // Publishing sweeps up the drafts already recorded against the work.
    $this->patch(route('editions.update', $edition), ['visibility' => 'published']);
    expect(Conjecture::where('text', 'while a draft')->sole()->visibility)->toBe(Visibility::Published);

    // Recorded into a public apparatus: a reader who sees it printed must
    // find it on the work page too, so it is born published.
    $this->post(route('conjectures.store', $passage), ['text' => 'once public', 'proposed_by' => 'Porson'])->assertRedirect();
    expect(Conjecture::where('text', 'once public')->sole()->visibility)->toBe(Visibility::Published);

    // The fixture's own conjecture, the swept-up draft, and the new one.
    auth()->logout();
    $this->get(route('works.show', $work))
        ->assertInertia(fn ($page) => $page->has('conjectures', 3));
});
