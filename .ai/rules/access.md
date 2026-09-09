---
paths:
  - 'app/Policies/**'
  - app/Enums/Role.php
  - app/Models/User.php
  - 'app/Support/Copying/**'
  - app/Support/Edition/EditionPublisher.php
  - app/Http/Controllers/EditionEditorController.php
  - app/Http/Controllers/EditionOwnershipTransferController.php
  - app/Http/Controllers/EditionCopyController.php
  - app/Http/Controllers/WitnessCopyController.php
  - 'app/Http/Requests/**'
  - routes/web.php
  - resources/js/lib/auth.ts
---

# Access

## Ownership, not a global editor role, decides who edits what
This replaced the "fully collaborative: any editor can act on anything"
model (user decision, September 2026). Every registered member (`Role::Member`,
the default — the old name `guest` is gone) creates and OWNS works,
witnesses, editions and conjectures (`user_id`). The site-wide `Role` only
says what she may do to OTHER people's material: `Editor` may edit
anything but never delete it, publish it, or grant privileges or
ownership; `Administrator` may do everything — granted once, in
`Gate::before` (AppServiceProvider), so no policy repeats it.

The WORK is the hub (`Work::isEditableBy`): a work is editable by its
owner and by the owner or invited editors of any of its editions; a
witness by its owner or whoever may edit a work one of its transcriptions
cites (`Witness::relatedWorks`); a conjecture by its owner or whoever may
edit its passage's work. That is how "editing privileges of an edition
come with its witnesses and conjectures" is realised — nothing is granted
per witness. Citing a segment INTO a work therefore requires `update` on
that work (`TranscriptionSegmentController::store/assignCitation`) — it
creates passages and re-collates, and it would otherwise let a stranger
attach her witness to someone's edition. The witness page offers only
works the member may cite into (`Work::editableOrAllFor`).

Owner-only, never an invited or site-wide editor: `delete` (works,
witnesses, editions), `publish` (an edition — and, `WitnessPolicy::
publish`, a transcription by hand), `manageEditors`, `transfer`
(EditionPolicy). Deleting a conjecture is edit-class (managing the
stockpile). `copy` is open to any member once the thing is published.

Guards against destroying or hiding what others rely on. Ownership makes
these load-bearing: one member's ordinary action would otherwise gut
another's published edition, since the cascades reach every edition.

- A work cannot be deleted by its owner while an edition of it belongs to
  someone else (`WorkPolicy::delete`).
- A witness cannot be deleted by its owner while another member's edition
  prints text from it — as a passage's base or as a chosen reading
  (`Witness::isPrintedByAnothersEdition`, used by `WitnessPolicy::delete`).
  The same question, asked of one transcript's layers, refuses
  `TranscriptionController::destroy` with a message rather than a 403,
  since the pane has no per-transcript ability to hide the button by.
- A transcription a PUBLISHED edition cites cannot be taken back to a
  draft — unpublish the edition, which retracts it
  (`TranscriptionController::update`).
- The only administrator cannot be demoted (`Admin\UsersController`).

An administrator passes all of these (`Gate::before`) — someone has to be
able to clear up. The member an edition is OFFERED to may view it before
answering (`EditionPolicy::view`).

Data that crosses a boundary is refused at validation, since the copier
maps by owner: a page break names a page of the layer's own witness
(`StoreTranscriptionPageBreakRequest`), a span copy's source must be
viewable (`TranscriptionSpanCopyController` authorizes `view`), and
`EditionPassageController::store` adds only passages of the edition's own
work whatever else the layer cites.

Every mutating route is `auth` and authorizes against its resource — in
the FormRequest's `authorize()` where one exists (so an unauthorized
request gets 403 BEFORE validation and learns nothing from the rules;
tests assert 403 with deliberately invalid payloads), else in the
controller. The `visibleTo` scopes admit editors/administrators, then
published things, then what the viewer may edit — written as `whereIn`
subqueries (`Work::editableBy` etc.), because larastan types the closure
of `whereHas`/`orWhere` as `Builder<Model>` and rejects scope calls in it.

Pages never decide: each controller ships `can` (`edit`, `delete`,
`publish`, `manage`, `transfer`, `copy`, `createEdition`, …) and the page
shows or hides by it; `isEditorOrAbove` is no longer used for gating.
Home and bibliography rows carry per-row `can_delete`/`can_edit`.

## Grants and handing on
`edition_editors` (pivot, `Edition::editors()`) is the owner's invitation
list, by exact email. `edition_ownership_transfers` is an OFFER: ownership
moves only when the member named accepts — enforced in the controller,
NOT a policy, because `Gate::before` would let an administrator accept on
her behalf, which is the one thing acceptance exists to prevent. One open
offer per edition (checked in code — a partial unique index is not
portable). Accepting removes the new owner from the editors list. Offers
are answered on the profile page; the header shows the pending count
(`auth.pendingOffers`).

## Publishing cascades to the work's evidence, and back
`EditionPublisher`: publishing an edition publishes every transcription
citing its work and every conjecture on the work (user decision: "everything
connected to the work", not only what the edition draws on). Unpublishing
takes them back unless another published edition of the work remains; a
transcription also cited by a published edition of ANOTHER work stays
public. Witness visibility stays derived from its transcriptions;
`Conjecture.visibility` was added for this. `ConjectureCatalogue::forWork`
takes the viewer so readers see only published conjectures.

## A conjecture is born with the work's standing
A conjecture recorded against a work that ALREADY has a published edition
is created published (`EditionPublisher::visibilityForConjectureOn`, used
at all three creation sites — `ConjectureController`,
`ConjectureOrderingController`, `ReadingSourceResolver`). Otherwise it
would be printed in a public apparatus and simultaneously missing from the
work page, which filters by visibility. Where no edition is published it
stays a draft, and `publish()` sweeps it up later. The copiers are the
deliberate exception: a copy is always a draft.

## A copy is a whole of its own — including the work
`EditionCopier` (user decision: full clone, because `Lemma`/`LemmaReading`
are shared by every edition of a WORK, so a copy sharing the work would
re-collate the original when edited). It copies the work (slug
`-copy`, `-copy-2`, …) and passages, every witness citing the work with
only the transcriptions that cite it (`WitnessCopier`: pages, photographs
duplicated on disk, features, both layers, segments citing the work,
regions, page breaks, fresh `group_id`s per counterpart pair), the
conjectures (supplements rewired in a second pass, ordering entries,
citations), the collation, and the edition's passages, selections, line
breaks, notes, adoptions and citations. Shared, not copied: the reference
scheme and bibliography items. The copy is a draft with no editors, owned
by the copier, `copied_from_id` set throughout. A witness copied ON ITS
OWN (`witnesses.copy`) arrives without citations — they belong to a work
the copier does not own. Both copiers copy only what the copier may SEE
(`visibleTo` on transcriptions, images and conjectures) and skip rows
whose target was not copied, so a copy is never a way to read a draft. A
witness whose transcriptions of the work the copier may not read is left
out entirely rather than copied as a siglum with pages and no text.
`replicate()` carries LOADED RELATIONS onto the copy (real incident: the
copied edition's `->work` still pointed at the original and the redirect
404ed) — reset them (`setRelation`/`setRelations([])`) whenever the
foreign key changes.
