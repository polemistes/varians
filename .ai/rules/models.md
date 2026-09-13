---
paths:
  - 'app/Models/{Segment,Assignment,Transcription,ReferenceScheme}.php'
  - 'app/Models/{Transcription,Assignment,Witness,Work}.php'
  - app/Models/User.php
  - 'app/Models/{Conjecture,Lemma,LemmaReading,EditionLemma,EditionBase}.php'
  - 'app/Support/Edition/**'
  - app/Models/ReferenceScheme.php
---

# Models

## Segment identity vs. reading order are separate fields
Segment.sort_key/address is the permanent assignment number (e.g. "line 1000") and must never be renumbered based on where the text actually belongs.

Within one *transcription*, physical/reading order is not a stored field at all — it's simply a `Assignment`'s offset position within that transcription's continuous `text` (manuscripts sometimes transpose segments, e.g. "line 1000" physically sitting between 976 and 977 but keeping the assignment "1000" via its `segment_id`; order by `start_offset` to see physical order, by the segment's `sort_key` to see numbering order — never assume they match).

The one stored ordering on assignments is `part`, and it is *within* one segment's assignment, not across the transcription: several spans in a layer may assign the same segment (its witness text is discontinuous — a transposition split it below segmentation granularity), and `part` records which fragment reads first as content, independent of physical offsets. Consume parts via `Assignment::inPartOrder`/`sortByPartOrder`; see `.ai/rules/edition.md` for the collation consequences.

Within one *segment's collation*, `Lemma.position` (decimal, orderable/insertable) **is** a real stored ordering column — unlike a transcription, a lemma's candidate readings can come from unrelated transcriptions with unrelated offsets, so there's no shared coordinate space order could be derived from; the sequence has to be recorded explicitly. A lemma reading whose source span falls inside a *different* segment's assignment is a transposition, detected by comparison at display time, not a stored flag.

## Transcription↔Work and Witness↔Work associations are both fully derived, not stored
A `Transcription` belongs to a `Witness` only (`witness_id`) — it has no `work_id`. `Assignment.segment_id` is **NOT NULL** — an assignment always assigns text to a segment; there is no "unassigned" state (marking a span and assigning text to it happen in one step). `Assignment` also no longer has a `position` column — physical/reading order is simply a span's offset in the transcription's continuous `text`.

Consequences:
- To list transcriptions relevant to a Work, use `Transcription::forWork($work)` (a scope that checks `whereHas('assignments.segment', ...)`) — there is no `Work::transcriptions()` relation.
- Changing which segment an assignment points at happens via `AssignmentController::reassign` (route `assignments.reassign`), which resolves a `{work_id, label}` pair through `ReferenceScheme::parseLabel()`/`format()` into a `segment_id` (`firstOrCreate`). There is no way to clear an assignment — remove the span instead.
- **Witness↔Work has no pivot table** (the old `work_witness` table was removed) — it's a derived relationship computed from assignment data: `Work::relatedWitnesses()` / `Witness::relatedWorks()` (plain `Builder`-returning methods, not Eloquent relations, since the chain is witness → transcription → assignment → segment → work). A witness is only "related" to a work once one of its transcriptions has an assignment assigning text to that work; nothing attaches them directly.
- Routes for transcriptions take only `{transcription}`, never `{work}/{transcription}`.

`Edition`, by contrast, genuinely does belong directly to a `Work` (`Work::editions(): HasMany`) — it's an editorial artifact the editor explicitly creates, not something inferable from assignment data, so it doesn't follow the derived-relationship pattern above.

## User.role is deliberately not fillable — use forceFill or direct assignment
`role` is excluded from User's #[Fillable] on purpose, to prevent privilege escalation via mass assignment (e.g. a registration form payload). This means `User::create(['role' => ...])` or `$user->update(['role' => ...])` silently drops the field. Registration doesn't need to set it explicitly — the `role` column defaults to 'member' in the migration. The one legitimate place role changes (Admin\UsersController::updateRole, gated by role:administrator middleware) must use `$user->forceFill(['role' => $newRole])->save()` to intentionally bypass the guard. Factories are unaffected — Eloquent factories bypass fillable/guarded entirely via Model::unguarded(), so `'role' => Role::Member` in UserFactory::definition() works normally.

## Conjectures of every kind are recorded and edited on the Work page
`conjectures.store` (per segment) records ANY kind as a catalogue entry —
including transposition and reordering, applied to no edition (an edition
follows one through `edition-order.apply`, or records-and-follows a new
reordering through `conjecture-orderings.store`). `conjectures.update` edits every field;
`ConjectureShape` is the one matrix of what each kind must carry, checked
against the MERGED record on update, and a kind cannot change while the
conjecture is placed, adopted or filled by a supplement. Fields a kind
does not use are cleared on save; a reordering hangs from the first
segment of its stretch by numbering order (`reorderingAnchor`), and its
sequence is replaced whole. `WorkController::conjectures()` ships the
list with where each is in use; `DeletionImpact::forConjecture` backs the
delete confirmation (user decision: the Work page is where the stockpile
is managed — add, edit, delete — while editions place and follow).

## Conjecture has two distinct "who" fields — don't collapse them
`Conjecture.user_id` is the OWNER — who entered the record into Varians (the modern editor doing data entry) and may edit it, along with anyone who may edit the work (see `.ai/rules/access.md`).

`Conjecture.proposed_by` (nullable string) is something entirely different: the historical scholar who first proposed the conjecture, often centuries ago (e.g. "Bentley"). Most conjectures recorded in this app are NOT the current editor's own idea — they're recording one already published, so `proposed_by` is the field that actually matters for apparatus display, not `user_id`.

Display/apparatus code should show `proposed_by`, falling back to `user.name` only when `proposed_by` is null (see `EditionController::readingDetail()`/`segmentDetail()` for the pattern). Never substitute one field for the other or drop `proposed_by` as "redundant" with `user_id` — they answer different questions.

Where a conjecture was published is structured: `Conjecture::references()` (BibliographyReference rows citing BibliographyItem, see `.ai/rules/bibliography.md`). The old free-text `bibliography` column is DROPPED (user decision, nothing worth converting) — do not bring a free-text field back beside the citations.

## Lemma/LemmaReading are shared collation; EditionLemma is a thin per-edition selection — don't merge them back
This was a real bug caught in review: an earlier version of this feature made `EditionLemma` own the lemma/reading data directly, scoped to one `Edition`. That's wrong — an apparatus must report what part of the (often differing) manuscript readings a conjecture replaces *even when no edition ever selects it*, and different editions of the same work need to share the same word-level collation rather than each re-splitting a line from scratch.

So: `Lemma` (a word/phrase slot within a `Segment`) and `LemmaReading` (a candidate reading attached to a lemma — a transcription span or a `Conjecture`) are edition-independent. `EditionLemma` is just `{edition_id, lemma_id, selected_reading_id}` — which candidate a given edition currently prints. `selected_reading_id` is NOT NULL and cascades on delete: a row's mere *existence* is "this edition has picked something for this lemma"; there is no separate "in scope but undecided" state, since "no row" already means undecided.

A conjecture attached to a `Lemma` via a `LemmaReading` is positioned and reportable regardless of whether any `EditionLemma` selects it — "unattached" (`Conjecture::whereDoesntHave('lemmaReadings')`) means no lemma references it at all, not "no edition selected it." Never gate a conjecture's positional data behind an edition's selection again.

## Lemma columns are grown by alignment, never hand-built — and never anchor to a base transcription
There is no more `lemmas.store`/`lemmas.split`/`lemma-readings.store` — a `Lemma` is a segment-level, transcription-independent alignment column, and the only way new ones come into existence is `App\Support\Edition\SegmentAligner::alignWitness()`, which progressively diffs a witness's tokens against a segment's existing columns (word-level LCS) and grows them as needed. This is deliberate: a `Lemma`'s identity is "a slot in this segment," never "an offset range in transcription X" — only `LemmaReading.start_offset/end_offset` are transcription-specific, and only because rendering/highlighting needs them, not because they locate the column.

The base is per-segment now: `EditionSegment.transcription_layer_id` records which transcription's own wording is that segment's *display* default — nothing more. The range-level `EditionBase` model and `BaseResolver` are GONE (do not go looking for them; only a comment in StoreEditionSegmentsBulkRequest still names the old range for contrast). Every add path sets the added segment's base to the source transcript equally — the "Add lines…" bulk add differs only in addressing an assignment range instead of a physical selection, and in skipping segments already added, which is how a multi-witness patchwork is built. The old rule's principle stands unchanged: the base is never a structural anchor (never require a `LemmaReading` to exist for "the base" for a `Lemma` to be valid), and changing a segment's base must never orphan anything recorded against the old one, only change what's shown by default.

`EditionVariantController::store` is the one place a `Lemma`/`LemmaReading` gets created going forward — it materializes a segment (aligns every witness assigning text to it) on first touch, then places whatever was picked (a witness reading, a catalogued Conjecture, or a brand new one) at the exact column, and upserts the `EditionLemma` selection in the same request. There are no lemma or lemma-reading routes at all any more (the old correction routes were never called from the client and were removed); `EditionLemmaController` keeps only `destroy`, which withdraws an edition's choice.

## A lacuna is a pure insertion; its restoration is a separate Supplement; a transposition never touches Lemma/LemmaReading at all
`ConjectureType` has four cases, and only two of them (Substitution, Supplement) ever carry `text`:

- **Lacuna**: `text` is always null (rejected at validation if given) — a lacuna never competes with an existing word, it's inserted as a brand-new zero-width `Lemma` column *between* two existing ones (see `EditionVariantController::resolveInsertedLemma`, reached via `placement=insert` on `StoreEditionVariantRequest`, never `placement=existing`). `extent` is an optional free-text description of how much is believed missing.
- **Supplement**: a proposed restoration for one specific Lacuna (`supplements_conjecture_id`, a self-referencing FK). Several supplements, credited to different proposers, can compete for the very same lacuna — that's the whole reason Supplement is its own type rather than letting Lacuna carry a single `text`. A supplement is placed exactly like a substitution, as another candidate `LemmaReading` on the lacuna's own `Lemma` (`EditionVariantController::guardSupplementMatchesLemma` rejects one that targets a lacuna not actually on the clicked column).
- **Transposition**: `text` is always null and it **never gets a `LemmaReading`** — it's an edition-ordering proposal, not a word-level one. `segment_id` (through `transposition_range_end_segment_id`, inclusive, for a multi-segment range) is proposed to move `move_position` ('before'/'after') `move_target_segment_id`. Recording one goes through `ConjectureController::store` (the Work page's list), the order panel (`ConjectureOrderingController`) or an unattested cut-and-paste (`EditionOrderController::move`), never `EditionVariantController` (which explicitly rejects `conjecture_type=transposition`). `EditionTranspositionController` is gone: the edition page's transposition list was removed once conjectures became editable from the Work page.
- **Reordering**: `text` null; its `ConjectureOrderingEntry` rows are the proposed sequence of PIECES — normally whole segments (`part` 1, `text` null), but the edition page's cut-and-paste registering may divide a segment into parts with their words, the same shape as a witness's split assignment and reported by the same code. Adopting such an arrangement prints the line in pieces — one `EditionSegment` row per part (`part`, `part_text`), see `ArrangementAdopter` and `.ai/rules/edition.md`. `ConjectureShape::orderedSegmentIds` gives the segments once each (first part's place); rewriting the sequence from the Work page form flattens the parts.

**Order is materialized** (redesign, replacing the old render-time two-phase reordering): `EditionSegment.position` IS the printed order, mutable, and every change goes through `SegmentOrderRewriter` (locked transaction, wholesale renumber 1..n). `EditionTransposition` (`{edition_id, conjecture_id}`) is a pure *attribution* record — "this edition applied this proposal" — serving both Transposition and Reordering conjectures; it no longer affects rendering, and removing one leaves the order as it is (**one-way apply**, a deliberate user decision: an automatic revert would be unreliable once the editor rearranged anything on top). Direct cut-and-paste (`EditionOrderController::move`) and applying an order-report candidate (`::applyCandidate` — a witness's sequence, a catalogued conjecture with attribution, or numbering order) are the other two writers. An edition's own segment order can float free of segment `sort_key` order, the same way a single transcription's physical order already can (see the "Segment identity vs. reading order" note above); each segment keeps its own segment label wherever it lands. The `edition_segment_orders` table and its "settled range" mechanism are gone: the order report (`EditionController::orderRanges`) is a calm, always-derived comparison (like the ⇄ marker — "detected by comparison at display time, not a stored flag", the same principle as ever), so the historical flip-flop incident cannot recur because nothing prompts action.


## LemmaReading.omitted is a witness's absence, not a tombstone

A zero-width reading with `omitted = true` says the witness has *no* word at
the columns it spans (written by `SegmentAligner::recordOmissions`); a
zero-width reading with `needs_review = true` is a selected reading a text
edit destroyed. Never infer either from width alone. Every query for a
witness's real wording must add `->where('omitted', false)`. A
`ConjectureType::Deletion` is the conjectural counterpart: `text` null,
placed as a range reading like a substitution, printing nothing when
adopted. See `.ai/rules/edition.md`, "Omissions are readings".

## A scheme's level values are free-text, even when typed "integer"
An "integer"-typed level (e.g. line number) still accepts and stores an alphanumeric value like "4a" or "80A" — editors must be free to name any assignment whatever they like; only the scheme's *structure* (how many levels, separators) is enforced, never a level's value format.

Since 2026-09-13 EVERY level holds ANY string, whatever its type (user decision: "2.4A" for a lacuna line, "45bis", a letter level with a digit in it). The type decides only how values SORT (`format()`'s integer branch, `padIntegerLevel()`, pads the leading digit run and appends the rest literally, so "4" < "4a" < "5") and what `nextLabel` in `lib/segmentLabel.ts` proposes next (trailing digits +1, else the next letter). `parseLabel()` divides a label by the SEPARATORS — each level takes the shortest stretch that lets the rest match (`(.+?)`) — and only where two levels meet with NO separator do the types decide the boundary: `(\d+)` for the integer side, `(\D+)` for the other (Stephanus "327a"). Such a pair must differ in type; `StoreWorkRequest` refuses two same-typed levels with no separator. "No separator" is a real choice in the scheme form (a select: full stop, colon, comma, hyphen, space, none); the client sends 'none'/'space' by word because the trimming/empty-to-null middleware would turn '' and ' ' into null, which the model reads as the legacy default '.' — `WorkController::withSeparatorCharacters` converts. Values are cast to `int` only when pure digits (`ctype_digit`); the client's `addressValue` mirrors that for the segment picker. Don't revert to a digits-only grammar — "4a" being refused was a real bug.

## A whole-line lacuna is placement=new_segment, not placement=insert
A lacuna spanning a whole missing line (no manuscript witness at all) is a *different* placement from a point lacuna inserted mid-segment:
- Point lacuna: `placement=insert` — a zero-width Lemma inserted between two existing ones in an *already-numbered* segment (unchanged, pre-existing mechanism).
- Whole-line lacuna: `placement=new_segment` — the editor types a `label` (e.g. "80A") instead of a `segment_id`; `SegmentResolver::resolve()` finds-or-creates that Segment via the work's ReferenceScheme, then `EditionVariantController::resolveWholeSegmentLemma()` finds-or-creates that segment's *one* Lemma (`firstOrCreate` on `segment_id` alone) so a repeated submission for the same label lands a competing reading on the same column instead of duplicating the segment/lemma.

A lacuna that visually spans a line boundary (starts mid-line, continues for whole lines, resumes mid-line) is deliberately NOT one linked record — it's several independent lacunas (point + whole-line + point), authored separately. There is no cross-segment lacuna data structure; don't build one.

`Conjecture.extent_characters` (nullable int, separate from the free-text `extent`) sizes the proportional `< ... >` gap glyph in `Editions/Show.vue` — only set when a lacuna reading is actually selected (see `EditionController::materializedSingleRun`); null falls back to the old bracketed `[lacuna: ...]` text render, so lacunas authored before this feature are unaffected.
