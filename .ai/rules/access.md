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
assigns (`Witness::relatedWorks`); a conjecture by its owner or whoever may
edit its segment's work. That is how "editing privileges of an edition
come with its witnesses and conjectures" is realised — nothing is granted
per witness. Assigning an assignment INTO a work therefore requires `update` on
that work (`AssignmentController::store/reassign`) — it
creates segments and re-collates, and it would otherwise let a stranger
attach her witness to someone's edition. The witness page offers only
works the member may assign text to (`Work::editableOrAllFor`).

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
  prints text from it — as a segment's base or as a chosen reading
  (`Witness::isPrintedByAnothersEdition`, used by `WitnessPolicy::delete`).
  The same question, asked of one transcript's layers, refuses
  `TranscriptionController::destroy` with a message rather than a 403,
  since the pane has no per-transcript ability to hide the button by.
- A transcription a PUBLISHED edition assigns cannot be taken back to a
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
`EditionSegmentController::store` adds only segments of the edition's own
work whatever else the layer assigns.

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
assigning text to its work and every conjecture on the work (user decision: "everything
connected to the work", not only what the edition draws on). Unpublishing
takes them back unless another published edition of the work remains; a
transcription also assigned by a published edition of ANOTHER work stays
public. Witness visibility stays derived from its transcriptions;
`Conjecture.visibility` was added for this. `ConjectureCatalogue::forWork`
takes the viewer so readers see only published conjectures.

## A copy keeps the original's name — the lists say who and when
Copying gives the copy the original's title or siglum, so a list of
editions, works or witnesses shows several identical rows. Every such list
carries `user` (the owner) and `created_at`, and shows them:
`resources/js/lib/provenance.ts` formats the pair, the DATE visible and the
exact TIME in the `title` tooltip (user decision — two copies made minutes
apart are rare, a clock on every row is noise). The transcript picker on
the witness page puts the date IN the option text as well, since a
`<select>` cannot carry a tooltip; the line beside it names the layers'
author, not the owner, because every transcript of a witness shares one
owner and naming her there would say nothing.

Any new list that can show a copy must ship both columns and use the same
helper — otherwise the copies are indistinguishable again.

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
`-copy`, `-copy-2`, …) and segments, every witness assigning text to the work with
only the transcriptions that assign it (`WitnessCopier`: pages, photographs
duplicated on disk, features, both layers, assignments assigning text to the work,
regions, page breaks, fresh `group_id`s per counterpart pair), the
conjectures (supplements rewired in a second pass, ordering entries,
assignments), the collation, and the edition's segments, selections, line
breaks, notes, adoptions and assignments. Shared, not copied: the reference
scheme and bibliography items. The copy is a draft with no editors, owned
by the copier, `copied_from_id` set throughout.

THE ASSIGNMENTS FOLLOW ANY COPY (user decision, reversing an earlier one).
A witness copied on its own used to arrive unassigned, reasoning that its
assignments named a work the copier may not edit; that was wrong and was
reported. The assignments ARE the transcription work, and a copy without
them is a wall of text somebody must assign again line by line.

WHAT THEY POINT AT depends on whose witness it is, decided once per copy by
`can('update', $witness)` — the owner, or whoever has editing privileges on
one of its works:

- A witness the copier MAY EDIT keeps its assignments on the very same
  segments. Her edits then show up as variants in her own editions of that
  work and in the shared edition she took the witness from, which is the
  point of copying a witness one already works on.
- SOMEONE ELSE'S public witness brings copies of the works it assigns text
  to (`WorkCopier`, shared with `EditionCopier`), and every assignment moves
  onto those. Her copy reaches no apparatus but her own. Since that puts
  works in her list she never asked for by name, `WitnessCopyController`
  flashes a notice saying so.

Conjectures are NOT copied with a witness: they belong to the edition
story, and a witness copy is about the manuscript.

Both copiers copy only what the copier may SEE
(`visibleTo` on transcriptions, images and conjectures) and skip rows
whose target was not copied, so a copy is never a way to read a draft. A
witness whose transcriptions of the work the copier may not read is left
out entirely rather than copied as a siglum with pages and no text.
`replicate()` carries LOADED RELATIONS onto the copy (real incident: the
copied edition's `->work` still pointed at the original and the redirect
404ed) — reset them (`setRelation`/`setRelations([])`) whenever the
foreign key changes.
