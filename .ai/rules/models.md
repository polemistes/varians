---
paths:
  - 'app/Models/{CanonicalPassage,TranscriptionSegment,Transcription,ReferenceScheme}.php'
  - 'app/Models/{Transcription,TranscriptionSegment,Witness,Work}.php'
  - app/Models/User.php
  - 'app/Models/{Conjecture,Lemma,LemmaReading,EditionLemma,EditionBase}.php'
  - 'app/Support/Edition/**'
  - app/Models/ReferenceScheme.php
---

# Models

## Citation identity vs. reading order are separate fields
CanonicalPassage.sort_key/address is the permanent citation number (e.g. "line 1000") and must never be renumbered based on where the text actually belongs.

Within one *transcription*, physical/reading order is not a stored field at all — it's simply a `TranscriptionSegment`'s offset position within that transcription's continuous `text` (manuscripts sometimes transpose passages, e.g. "line 1000" physically sitting between 976 and 977 but keeping the citation "1000" via its `canonical_passage_id`; order by `start_offset` to see physical order, by the passage's `sort_key` to see citation order — never assume they match).

The one stored ordering on segments is `part`, and it is *within* one passage's citation, not across the transcription: several spans in a layer may cite the same passage (its witness text is discontinuous — a transposition split it below segmentation granularity), and `part` records which fragment reads first as content, independent of physical offsets. Consume parts via `TranscriptionSegment::inPartOrder`/`sortByPartOrder`; see `.ai/rules/edition.md` for the collation consequences.

Within one *passage's collation*, `Lemma.position` (decimal, orderable/insertable) **is** a real stored ordering column — unlike a transcription, a lemma's candidate readings can come from unrelated transcriptions with unrelated offsets, so there's no shared coordinate space order could be derived from; the sequence has to be recorded explicitly. A lemma reading whose source span falls inside a *different* canonical passage's segment is a transposition, detected by comparison at display time, not a stored flag.

## Transcription↔Work and Witness↔Work associations are both fully derived, not stored
A `Transcription` belongs to a `Witness` only (`witness_id`) — it has no `work_id`. `TranscriptionSegment.canonical_passage_id` is **NOT NULL** — a segment always cites a canonical passage; there is no "unassigned" state (marking a span and citing it happen in one step). `TranscriptionSegment` also no longer has a `position` column — physical/reading order is simply a span's offset in the transcription's continuous `text`.

Consequences:
- To list transcriptions relevant to a Work, use `Transcription::forWork($work)` (a scope that checks `whereHas('segments.canonicalPassage', ...)`) — there is no `Work::transcriptions()` relation.
- Assigning/reassigning a segment's citation happens via `TranscriptionSegmentController::assignCitation` (route `transcription-segments.assign`), which resolves a `{work_id, label}` pair through `ReferenceScheme::parseLabel()`/`format()` into a `canonical_passage_id` (`firstOrCreate`). There is no way to clear a citation — remove the span instead.
- **Witness↔Work has no pivot table** (the old `work_witness` table was removed) — it's a derived relationship computed from citation data: `Work::relatedWitnesses()` / `Witness::relatedWorks()` (plain `Builder`-returning methods, not Eloquent relations, since the chain is witness → transcription → segment → canonical passage → work). A witness is only "related" to a work once one of its transcriptions has a segment citing that work; nothing attaches them directly.
- Routes for transcriptions take only `{transcription}`, never `{work}/{transcription}`.

`Edition`, by contrast, genuinely does belong directly to a `Work` (`Work::editions(): HasMany`) — it's an editorial artifact the editor explicitly creates, not something inferable from citation data, so it doesn't follow the derived-relationship pattern above.

## User.role is deliberately not fillable — use forceFill or direct assignment
`role` is excluded from User's #[Fillable] on purpose, to prevent privilege escalation via mass assignment (e.g. a registration form payload). This means `User::create(['role' => ...])` or `$user->update(['role' => ...])` silently drops the field. Registration doesn't need to set it explicitly — the `role` column defaults to 'guest' in the migration. The one legitimate place role changes (Admin\UsersController::updateRole, gated by role:administrator middleware) must use `$user->forceFill(['role' => $newRole])->save()` to intentionally bypass the guard. Factories are unaffected — Eloquent factories bypass fillable/guarded entirely via Model::unguarded(), so `'role' => Role::Guest` in UserFactory::definition() works normally.

## Conjecture has two distinct "who" fields — don't collapse them
`Conjecture.user_id` is attribution for who entered the record into Varians (the modern editor doing data entry) — it follows this app's usual collaborative-attribution pattern (like Transcription.user_id).

`Conjecture.proposed_by` (nullable string) is something entirely different: the historical scholar who first proposed the conjecture, often centuries ago (e.g. "Bentley"). Most conjectures recorded in this app are NOT the current editor's own idea — they're recording one already published, so `proposed_by` is the field that actually matters for apparatus display, not `user_id`.

Display/apparatus code should show `proposed_by`, falling back to `user.name` only when `proposed_by` is null (see `EditionController::readingDetail()`/`passageDetail()` for the pattern). Never substitute one field for the other or drop `proposed_by` as "redundant" with `user_id` — they answer different questions.

`Conjecture.bibliography` (nullable text) is a free-text citation for where the conjecture was published — no structured bibliography/reference system exists, just a plain field the editor fills in.

## Lemma/LemmaReading are shared collation; EditionLemma is a thin per-edition selection — don't merge them back
This was a real bug caught in review: an earlier version of this feature made `EditionLemma` own the lemma/reading data directly, scoped to one `Edition`. That's wrong — an apparatus must report what part of the (often differing) manuscript readings a conjecture replaces *even when no edition ever selects it*, and different editions of the same work need to share the same word-level collation rather than each re-splitting a line from scratch.

So: `Lemma` (a word/phrase slot within a `CanonicalPassage`) and `LemmaReading` (a candidate reading attached to a lemma — a transcription span or a `Conjecture`) are edition-independent. `EditionLemma` is just `{edition_id, lemma_id, selected_reading_id}` — which candidate a given edition currently prints. `selected_reading_id` is NOT NULL and cascades on delete: a row's mere *existence* is "this edition has picked something for this lemma"; there is no separate "in scope but undecided" state, since "no row" already means undecided.

A conjecture attached to a `Lemma` via a `LemmaReading` is positioned and reportable regardless of whether any `EditionLemma` selects it — "unattached" (`Conjecture::whereDoesntHave('lemmaReadings')`) means no lemma references it at all, not "no edition selected it." Never gate a conjecture's positional data behind an edition's selection again.

## Lemma columns are grown by alignment, never hand-built — and never anchor to a base transcription
There is no more `lemmas.store`/`lemmas.split`/`lemma-readings.store` — a `Lemma` is a passage-level, transcription-independent alignment column, and the only way new ones come into existence is `App\Support\Edition\PassageAligner::alignWitness()`, which progressively diffs a witness's tokens against a passage's existing columns (word-level LCS) and grows them as needed. This is deliberate: a `Lemma`'s identity is "a slot in this passage," never "an offset range in transcription X" — only `LemmaReading.start_offset/end_offset` are transcription-specific, and only because rendering/highlighting needs them, not because they locate the column.

`EditionBase` (`{edition_id, transcription_id, from_canonical_passage_id, to_canonical_passage_id}`) records which transcription's own wording is the *display* default for a range — nothing more. Never let it become a structural anchor (e.g. never require a `LemmaReading` to exist for "the base" for a `Lemma` to be valid) — reassigning a range's base transcription must never orphan anything recorded against the old one, only change what's shown by default. `App\Support\Edition\BaseResolver::covering()` is the one place "which base covers this passage" is answered; reuse it rather than re-deriving.

`EditionVariantController::store` is the one place a `Lemma`/`LemmaReading` gets created going forward — it materializes a passage (aligns every witness citing it) on first touch, then places whatever was picked (a witness reading, a catalogued Conjecture, or a brand new one) at the exact column, and upserts the `EditionLemma` selection in the same request. `LemmaController`/`LemmaReadingController` only keep `update`/`destroy` now, for correcting an already-materialized structure, not for building one.

## A lacuna is a pure insertion; its restoration is a separate Supplement; a transposition never touches Lemma/LemmaReading at all
`ConjectureType` has four cases, and only two of them (Substitution, Supplement) ever carry `text`:

- **Lacuna**: `text` is always null (rejected at validation if given) — a lacuna never competes with an existing word, it's inserted as a brand-new zero-width `Lemma` column *between* two existing ones (see `EditionVariantController::resolveInsertedLemma`, reached via `placement=insert` on `StoreEditionVariantRequest`, never `placement=existing`). `extent` is an optional free-text description of how much is believed missing.
- **Supplement**: a proposed restoration for one specific Lacuna (`supplements_conjecture_id`, a self-referencing FK). Several supplements, credited to different proposers, can compete for the very same lacuna — that's the whole reason Supplement is its own type rather than letting Lacuna carry a single `text`. A supplement is placed exactly like a substitution, as another candidate `LemmaReading` on the lacuna's own `Lemma` (`EditionVariantController::guardSupplementMatchesLemma` rejects one that targets a lacuna not actually on the clicked column).
- **Transposition**: `text` is always null and it **never gets a `LemmaReading`** — it's an edition-ordering proposal, not a word-level one. `canonical_passage_id` (through `transposition_range_end_canonical_passage_id`, inclusive, for a multi-passage range) is proposed to move `move_position` ('before'/'after') `move_target_canonical_passage_id`. Recording one always goes through `EditionTranspositionController::store`, never `EditionVariantController` (which explicitly rejects `conjecture_type=transposition`).

**Order is materialized** (redesign, replacing the old render-time two-phase reordering): `EditionPassage.position` IS the printed order, mutable, and every change goes through `PassageOrderRewriter` (locked transaction, wholesale renumber 1..n). `EditionTransposition` (`{edition_id, conjecture_id}`) is a pure *attribution* record — "this edition applied this proposal" — serving both Transposition and Reordering conjectures; it no longer affects rendering, and removing one leaves the order as it is (**one-way apply**, a deliberate user decision: an automatic revert would be unreliable once the editor rearranged anything on top). Direct cut-and-paste (`EditionOrderController::move`) and applying an order-report candidate (`::applyCandidate` — a witness's sequence, a catalogued conjecture with attribution, or citation order) are the other two writers. An edition's own passage order can float free of citation `sort_key` order, the same way a single transcription's physical order already can (see the "Citation identity vs. reading order" note above); each passage keeps its own citation label wherever it lands. The `edition_passage_orders` table and its "settled range" mechanism are gone: the order report (`EditionController::orderRanges`) is a calm, always-derived comparison (like the ⇄ marker — "detected by comparison at display time, not a stored flag", the same principle as ever), so the historical flip-flop incident cannot recur because nothing prompts action.

## A scheme's level values are free-text, even when typed "integer"
An "integer"-typed level (e.g. line number) still accepts and stores an alphanumeric value like "4a" or "80A" — editors must be free to name any segment whatever they like; only the scheme's *structure* (how many levels, separators) is enforced, never a level's value format.

`parseLabel()`'s integer branch matches `(\d+[A-Za-z]*)` and only casts to `int` when the match is pure digits (`ctype_digit`) — otherwise the address value stays a string. `format()`'s integer branch (`padIntegerLevel()`) pads only the leading digit run and appends any letters literally, so "4" < "4a" < "5" sorts correctly. Don't revert to `(\d+)`/`(int)` — that was a real bug (citing "4a" was rejected, and a naive cast silently truncated it to 4).

## A whole-line lacuna is placement=new_passage, not placement=insert
A lacuna spanning a whole missing line (no manuscript witness at all) is a *different* placement from a point lacuna inserted mid-passage:
- Point lacuna: `placement=insert` — a zero-width Lemma inserted between two existing ones in an *already-numbered* passage (unchanged, pre-existing mechanism).
- Whole-line lacuna: `placement=new_passage` — the editor types a `label` (e.g. "80A") instead of a `canonical_passage_id`; `CanonicalPassageResolver::resolve()` finds-or-creates that CanonicalPassage via the work's ReferenceScheme, then `EditionVariantController::resolveWholePassageLemma()` finds-or-creates that passage's *one* Lemma (`firstOrCreate` on `canonical_passage_id` alone) so a repeated submission for the same label lands a competing reading on the same column instead of duplicating the passage/lemma.

A lacuna that visually spans a line boundary (starts mid-line, continues for whole lines, resumes mid-line) is deliberately NOT one linked record — it's several independent lacunas (point + whole-line + point), authored separately. There is no cross-passage lacuna data structure; don't build one.

`Conjecture.extent_characters` (nullable int, separate from the free-text `extent`) sizes the proportional `< ... >` gap glyph in `Editions/Show.vue` — only set when a lacuna reading is actually selected (see `EditionController::materializedSingleRun`); null falls back to the old bracketed `[lacuna: ...]` text render, so lacunas authored before this feature are unaffected.
