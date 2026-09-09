<?php

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionOwnershipTransfer;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Inertia\Testing\AssertableInertia as AssertInertia;

/**
 * An owner's edition on her work, with a witness citing the work and a
 * conjecture recorded against it — everything a grant on the edition is
 * supposed to reach.
 *
 * @return array{owner: User, work: Work, edition: Edition, witness: Witness, layer: TranscriptionLayer, conjecture: Conjecture}
 */
function editionWithEvidence(): array
{
    $owner = User::factory()->create();
    $work = Work::factory()->for($owner)->create();
    $edition = Edition::factory()->for($owner)->for($work)->create();
    $passage = CanonicalPassage::factory()->for($work)->create();
    $witness = Witness::factory()->for($owner)->create();
    $layer = TranscriptionLayer::factory()->for($witness)->create(['text' => 'the quick fox']);
    TranscriptionSegment::factory()->for($layer)->for($passage, 'canonicalPassage')->create(['start_offset' => 0, 'end_offset' => 13]);
    $conjecture = Conjecture::factory()->for($owner)->for($passage, 'canonicalPassage')->create();

    return compact('owner', 'work', 'edition', 'witness', 'layer', 'conjecture');
}

test('a member may edit only her own things, and an invited editor gains the edition, its work, witnesses and conjectures', function () {
    ['owner' => $owner, 'work' => $work, 'edition' => $edition, 'witness' => $witness, 'conjecture' => $conjecture] = editionWithEvidence();
    $guest = User::factory()->create();

    $this->actingAs($guest);
    $this->patch(route('editions.update', $edition), ['title' => 'Mine now'])->assertForbidden();
    $this->patch(route('witnesses.update', $witness), ['siglum' => 'Z'])->assertForbidden();
    $this->patch(route('works.update', $work), ['title' => 'Renamed'])->assertForbidden();
    $this->patch(route('conjectures.update', $conjecture), ['type' => 'substitution', 'text' => 'x'])->assertForbidden();

    $this->actingAs($owner)
        ->post(route('edition-editors.store', $edition), ['email' => $guest->email])
        ->assertRedirect();
    expect($edition->editors()->whereKey($guest->id)->exists())->toBeTrue();

    $this->actingAs($guest);
    $this->patch(route('editions.update', $edition), ['title' => 'Edited by an invitee'])->assertRedirect();
    $this->patch(route('witnesses.update', $witness), ['siglum' => 'Z'])->assertRedirect();
    $this->patch(route('works.update', $work), ['title' => 'Renamed'])->assertRedirect();
    $this->patch(route('conjectures.update', $conjecture), ['type' => 'substitution', 'text' => 'x'])->assertRedirect();
    expect($edition->fresh()->title)->toBe('Edited by an invitee')
        ->and($witness->fresh()->siglum)->toBe('Z');

    // Editing, never owning: no publishing, deleting, inviting or handing on.
    $this->patch(route('editions.update', $edition), ['visibility' => 'published'])->assertForbidden();
    $this->delete(route('editions.destroy', $edition))->assertForbidden();
    $this->post(route('edition-editors.store', $edition), ['email' => User::factory()->create()->email])->assertForbidden();
    $this->post(route('edition-ownership-transfers.store', $edition), ['email' => $guest->email])->assertForbidden();
    $this->delete(route('witnesses.destroy', $witness))->assertForbidden();

    // And the owner takes it back.
    $this->actingAs($owner)->delete(route('edition-editors.destroy', [$edition, $guest]))->assertRedirect();
    $this->actingAs($guest)->patch(route('editions.update', $edition), ['title' => 'Again?'])->assertForbidden();
});

test('only the owner or an administrator invites editors — not another member, not a site-wide editor', function () {
    ['edition' => $edition] = editionWithEvidence();
    $invitee = User::factory()->create();

    $this->actingAs(User::factory()->create())
        ->post(route('edition-editors.store', $edition), ['email' => $invitee->email])
        ->assertForbidden();
    $this->actingAs(User::factory()->editor()->create())
        ->post(route('edition-editors.store', $edition), ['email' => $invitee->email])
        ->assertForbidden();
    $this->actingAs(User::factory()->administrator()->create())
        ->post(route('edition-editors.store', $edition), ['email' => $invitee->email])
        ->assertRedirect();
    expect($edition->editors()->whereKey($invitee->id)->exists())->toBeTrue();

    $this->actingAs($edition->user)
        ->post(route('edition-editors.store', $edition), ['email' => 'nobody@example.com'])
        ->assertSessionHasErrors('email');
});

test('the edition page tells the owner who edits, and a reader only who owns', function () {
    ['owner' => $owner, 'work' => $work, 'edition' => $edition] = editionWithEvidence();
    $invitee = User::factory()->create();
    $edition->editors()->attach($invitee->id, ['granted_by_id' => $owner->id]);

    $this->actingAs($owner)->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->where('can.manage', true)
            ->where('can.transfer', true)
            ->where('can.publish', true)
            ->where('access.owner.id', $owner->id)
            ->where('access.editors.0.id', $invitee->id));

    $this->actingAs($invitee)->get(route('editions.show', [$work, $edition]))
        ->assertInertia(fn (AssertInertia $page) => $page
            ->where('can.edit', true)
            ->where('can.manage', false)
            ->where('can.publish', false)
            ->where('access.owner.id', $owner->id)
            ->where('access.editors', []));
});

test('ownership moves only when the member offered accepts', function () {
    ['owner' => $owner, 'edition' => $edition] = editionWithEvidence();
    $heir = User::factory()->create();
    $edition->editors()->attach($heir->id, ['granted_by_id' => $owner->id]);

    $this->actingAs($owner)
        ->post(route('edition-ownership-transfers.store', $edition), ['email' => $heir->email])
        ->assertRedirect();
    $offer = $edition->ownershipTransfers()->open()->sole();
    expect($edition->fresh()->user_id)->toBe($owner->id);

    // A second offer waits for the first.
    $this->post(route('edition-ownership-transfers.store', $edition), ['email' => User::factory()->create()->email])
        ->assertSessionHasErrors('email');

    // Nobody accepts for her — not the owner, not an administrator.
    $this->actingAs($owner)->post(route('ownership-transfers.accept', $offer))->assertForbidden();
    $this->actingAs(User::factory()->administrator()->create())->post(route('ownership-transfers.accept', $offer))->assertForbidden();

    $this->actingAs($heir)->get(route('profile.edit'))
        ->assertInertia(fn (AssertInertia $page) => $page->where('offers.0.id', $offer->id));

    $this->actingAs($heir)->post(route('ownership-transfers.accept', $offer))->assertRedirect();

    expect($edition->fresh()->user_id)->toBe($heir->id)
        ->and($offer->fresh()->outcome)->toBe(EditionOwnershipTransfer::ACCEPTED)
        ->and($offer->fresh()->isOpen())->toBeFalse()
        ->and($edition->editors()->whereKey($heir->id)->exists())->toBeFalse();

    // The old owner is now just a member of the public.
    $this->actingAs($owner)->delete(route('editions.destroy', $edition))->assertForbidden();
    $this->actingAs($heir)->delete(route('editions.destroy', $edition))->assertRedirect();
});

test('an offer can be declined by the member offered, or withdrawn by the owner', function () {
    ['owner' => $owner, 'edition' => $edition] = editionWithEvidence();
    $heir = User::factory()->create();

    $this->actingAs($owner)->post(route('edition-ownership-transfers.store', $edition), ['email' => $heir->email]);
    $offer = $edition->ownershipTransfers()->open()->sole();

    $this->actingAs($heir)->post(route('ownership-transfers.decline', $offer))->assertRedirect();
    expect($offer->fresh()->outcome)->toBe(EditionOwnershipTransfer::DECLINED)
        ->and($edition->fresh()->user_id)->toBe($owner->id);

    $this->actingAs($owner)->post(route('edition-ownership-transfers.store', $edition), ['email' => $heir->email]);
    $second = $edition->ownershipTransfers()->open()->sole();

    $this->actingAs($heir)->delete(route('ownership-transfers.destroy', $second))->assertForbidden();
    $this->actingAs($owner)->delete(route('ownership-transfers.destroy', $second))->assertRedirect();
    expect($second->fresh()->outcome)->toBe(EditionOwnershipTransfer::WITHDRAWN);

    // A settled offer cannot be accepted after the fact.
    $this->actingAs($heir)->post(route('ownership-transfers.accept', $second))->assertForbidden();
});

test('an administrator may offer anyone\'s edition; a site-wide editor may not', function () {
    ['edition' => $edition] = editionWithEvidence();
    $heir = User::factory()->create();

    $this->actingAs(User::factory()->editor()->create())
        ->post(route('edition-ownership-transfers.store', $edition), ['email' => $heir->email])
        ->assertForbidden();
    $this->actingAs(User::factory()->administrator()->create())
        ->post(route('edition-ownership-transfers.store', $edition), ['email' => $heir->email])
        ->assertRedirect();
    expect($edition->ownershipTransfers()->open()->count())->toBe(1);
});

test('the header counts the offers awaiting an answer', function () {
    ['owner' => $owner, 'edition' => $edition] = editionWithEvidence();
    $heir = User::factory()->create();
    $this->actingAs($owner)->post(route('edition-ownership-transfers.store', $edition), ['email' => $heir->email]);

    $this->actingAs($heir)->get(route('home'))
        ->assertInertia(fn (AssertInertia $page) => $page->where('auth.pendingOffers', 1));
});

test('the member an edition is offered to may read it before answering', function () {
    ['owner' => $owner, 'work' => $work, 'edition' => $edition] = editionWithEvidence();
    $heir = User::factory()->create();
    $this->actingAs($heir)->get(route('editions.show', [$work, $edition]))->assertForbidden();

    $this->actingAs($owner)->post(route('edition-ownership-transfers.store', $edition), ['email' => $heir->email]);

    $this->actingAs($heir)->get(route('editions.show', [$work, $edition]))->assertOk();
    $this->actingAs(User::factory()->create())->get(route('editions.show', [$work, $edition]))->assertForbidden();

    $this->actingAs($heir)->post(route('ownership-transfers.decline', $edition->ownershipTransfers()->open()->sole()));
    $this->actingAs($heir)->get(route('editions.show', [$work, $edition]))->assertForbidden();
});

test('a member cannot reach another member\'s witness by making an edition on her work', function () {
    ['owner' => $owner, 'work' => $work, 'witness' => $witness] = editionWithEvidence();
    $stranger = User::factory()->create();

    // She may not start an edition on a work that is not hers to edit, so
    // the route to editing its witnesses never opens.
    $this->actingAs($stranger)
        ->post(route('editions.store', $work), ['title' => 'Mine'])
        ->assertForbidden();
    $this->patch(route('witnesses.update', $witness), ['siglum' => 'Z'])->assertForbidden();

    // Nor may she cite her own witness into that work to become connected to it.
    $ownWitness = Witness::factory()->for($stranger)->create();
    $layer = TranscriptionLayer::factory()->for($ownWitness)->create(['text' => 'the quick fox']);
    $this->post(route('transcription-segments.store', $layer), [
        'work_id' => $work->id,
        'label' => '1',
        'start_offset' => 0,
        'end_offset' => 3,
    ])->assertForbidden();

    // The owner inviting her opens both, and only then.
    $edition = $work->editions()->sole();
    $this->actingAs($owner)->post(route('edition-editors.store', $edition), ['email' => $stranger->email]);
    $this->actingAs($stranger)->patch(route('witnesses.update', $witness), ['siglum' => 'Z'])->assertRedirect();
});
