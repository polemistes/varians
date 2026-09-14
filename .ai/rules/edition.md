---
paths:
  - 'app/Support/Edition/**'
  - app/Models/Transcription.php
  - app/Enums/TranscriptionLayer.php
  - app/Http/Controllers/EditionController.php
  - app/Http/Controllers/EditionVariantController.php
---

# Edition

## Transcription.layer is structural — only normalized transcriptions collate
A witness is transcribed twice: `diplomatic` records what the manuscript
physically has (original orthography, Leiden markup, and the image-alignment
regions, since only that layer corresponds to marks on parchment), and
`normalized` is the editor's regularization — the layer collation runs on.

**A witness holds at most one transcription per layer** — two slots, enforced
by a unique index on `(witness_id, layer)`. The layer filter alone was not
enough: nothing stopped a witness having two *normalized* transcriptions (a
same-witness copy produced one), and both were collated, so the manuscript
appeared in its own apparatus disagreeing with itself. Uniqueness also settles
which normalized transcription is *the* one for a witness, a question the code
could not otherwise answer. One slot per layer suffices even for a manuscript
containing several works, since a Transcription has no `work_id`.

A copy (`transcriptions.fork.store`) names the slot it fills — `witness_id`
plus a required `layer` — and is refused if that slot is occupied, rather than
overwriting assignment spans, image regions and collated readings.

Only normalized transcriptions enter the apparatus (`SegmentAdder::materialize`
filters via `whereRelation('transcription', 'layer', ...)`, mirrored by the
`Transcription::collatable()` scope used in `EditionController::show`) and only
they may be an edition's base or a witness-sourced `LemmaReading` (guarded in
`StoreEditionSegmentRequest`, `StoreEditionSegmentsBulkRequest`,
`StoreEditionVariantRequest`). Without that filter a fork — which copies
assignment assignments verbatim — makes a manuscript appear in its own apparatus
disagreeing with itself over the very orthography the normalized layer
regularized.

This is a requirement of collation, not a rule imposed here: a fully
normalized witness cannot be collated against one preserving accents, because
every accent becomes a false variant.

**This deliberately reverses the 2026_08_17_152742 removal of a `type`
column.** That column was *descriptive*, and tags do description better;
`layer` is *structural* — it decides what enters the apparatus. Tags and layer
coexist. Do not "restore" the old rule that no fixed diplomatic/normalized
distinction may exist.

## Columns need not follow the edition's base — but everything reading them must allow for that
A segment's `Lemma` columns are shared across every edition of the work, so
they cannot line up with each edition's own base. A base that did not build the
columns has readings that span several of them, and both rendering and
placement have to cope:

- `EditionController::materializedRuns` jumps past the columns a base's own
  reading covers, exactly as it does for a selected range. Without that, those
  columns render independently and splice another manuscript's words into the
  printed text — an edition based on "the creature sleeps" printed "the
  creature red fox sleeps".
- `EditionVariantController`'s column lookup tries an exact base-offset match
  first, then falls back to the base reading that *contains* the offset,
  snapping the selection to the whole variant site. A reading cannot compete
  with half a column.
- `resolveRange` widens a range to cover everything the base's reading at its
  start already spans (`extendedOverBaseSpan`), or a conjecture replacing words
  that stand for three columns would claim only one and leave the rest to
  render beside it.

Keep exact matching first everywhere: a base that *did* build the columns must
keep resolving precisely as before.

## Collation is a function of the evidence, not of click order
`SegmentAligner::collate` is the entry point; `alignWitness` is the per-witness
step and should not be called directly outside it (tests aside).

Three things make the result independent of how an editor happened to work:

1. Witnesses align in **siglum order** (`collate`) — the conventional apparatus
   order and the only key derived from the evidence. Not `transcription_id`,
   which is creation order.
2. `representativeText` sorts a column's readings before choosing a consensus —
   `readings` is a bare `hasMany`, so an unsorted `first()` rests on storage
   order.
3. While a segment is still nothing but aligner output, `collate` **deletes the
   columns and rebuilds** from all witnesses at once. Ordering alone does not
   cover a witness assigned after the segment was collated that sorts before the
   ones that built it.

`hasEditorialContent` gates the rebuild: any reading with a `conjecture_id` (a
placement whose column is its only record — this also covers lacuna columns) or
any `EditionLemma` (an edition's decision, and since every
`EditionVariantController::store` path upserts one, this catches hand-placed
witness readings too, which are otherwise indistinguishable from aligner
output). Once either exists the segment appends instead, which is correct: its
structure is settled and should grow, not churn.

**Tests that assert column structure must pin witness sigla.** Factory sigla
are random, so leaving them makes the seed witness — and therefore the
structure — a coin flip. `editionWithBase()` pins "A" for the base and "B" for
the second witness for this reason.

## A segment's witness text can be discontinuous — collation consumes all its parts
A transposition can cut across the work's segmentation (half of line 40
standing where line 42 belongs), so several `Assignment` spans in
one layer may assign the same segment. `part` orders them by **content** (which
fragment reads first as text of the segment), independent of the physical
order their offsets give — the two disagreeing *is* the transposition. Never
"fix" one to match the other.

Consequences, all real code paths:
- The unit of alignment is the **layer**, not the span: `SegmentAligner::collate`
  groups a segment's assignments by layer and `alignWitness` takes ALL of a
  layer's parts, tokenizing them as one stream in part order. The
  `alreadyAligned` idempotency skip stays per layer.
- A diff merge must never fuse witness tokens from different parts into one
  reading — its offsets would span the physical gap or run backwards.
  `plan()` carries `$partStarts`; `mergeSubstitutions` cuts insert runs there
  and `reorderingWindow` rejects windows crossing a boundary.
- Assigning a segment the layer already assigns is the **late-part flow**
  (`AssignmentController::store`/`reassign`): refused with a
  structured `acknowledge_realignment` validation error until acknowledged,
  then `SegmentAligner::realignLayer` redoes that layer's collation — unless
  its readings are pinned (edition-selected, conjecture-carrying, or on a
  column whose only readings are this layer's and which carries an anchored
  EditionComment), in which case the readings are kept and every part is
  flagged `needs_review`. Never delete pinned readings: selections cascade.
- `realignLayer` also deletes columns left empty by removing the layer's
  readings — left standing they become blank consensus text and corrupt the
  re-alignment (this bit a single-witness segment in testing).
- Whole-segment order detection (`orderRanges`) keeps `min(start_offset)` as a
  segment's physical position, deliberately: a sub-segment transposition is
  reported per segment by `EditionController::assignmentDiscontinuities` (the
  violet line number, derived at display time, never stored) and must not
  register as a whole-segment reorder.
- The split-assignment report speaks apparatus, not mechanics
  (`EditionController::transpositionStatements`, user decision): "R2 has this
  segment in 2 places" is not how an edition reports a sub-line transposition.
  A fragment is DISPLACED when its physical predecessor assignment differs from
  its content predecessor (previous part in part order); two displaced
  fragments of different segments whose physical and content predecessors
  cross-match have CHANGED PLACES and are reported as one statement on both
  segments — 'R2: 4 2/2 "πάρεστιν ἐνταυθοῖ γυνή·" has exchanged places with
  5 2/2 "κωμῆτις ἥδʼ ἐξέρχεται."'. Fragments are assigned by part number
  (`label part/total`) PLUS their full verbatim text in quotes — never
  abbreviated `first … last` (user decision: a digital apparatus never
  abbreviates a lemma; an abbreviating `assignedSpan` version existed briefly
  and was removed). A lone displaced fragment is located against its
  physical neighbour ('B: 1.1 2/2 "fox" stands after 1.2'). Presentation (user decision):
  no ⇄ badge and no explanatory notice — the segment's assignment-label chip
  itself turns violet when a witness splits the segment, its hover title is
  the statements, and clicking it opens the panel showing only the
  statements. The mechanical per-part sentence survives only as the client's
  fallback when a multi-part segment has nothing displaced
  (`discontinuityLines` in `Editions/Show.vue`).
- `DiplomaticCounterpart` maps by token index over the concatenated parts in
  part order on both layers; `forSegment` joins part slices with " … " so a
  discontinuous line never presents as contiguous.

## The order report flags only disagreement with the PRINTED order, one block one marker
`EditionController::orderRanges` compares every source — each witness's
physical order AND each catalogued (attributed) Transposition/Reordering
conjecture — against the edition's PRINTED order (user decision, refining
an intermediate assignment-anchored design): the editor wants to be made
aware exactly where what she prints disagrees with a witness or with a
catalogued proposal, and of nothing else. NUMBERING ORDER IS NEVER A
SOURCE: that the printed order (or a manuscript's) departs from assignment
order is no news — the segment labels on the lines already say so — so
no site and no notice exists for it (the `assignmentOrderStatus` "restore
numbering order" notice was removed for this reason). The server still
ships numbering order as a candidate, but the client's panel no longer
offers it (user decision — no "Numbering order: …" row); the
`buildOrderRangeInfo` guard drops a block whose only differing candidate
is numbering order
(possible when the assignment-span expansion cost the disagreeing witness
its candidacy under the fragmentary rule).

Consequences, all deliberate:
- A block's extent is the assignment span (min..max sort_key) of the
  disagreeing stretch, so its members may be scattered in the printed
  text. Every member's window entry carries the same block info. There is
  NO separate ⇅ badge (user decision): the line-number chip itself carries
  the report — `isOrderMoved` colours exactly the lines some non-assignment
  candidate MOVES (`analyzeSequence().movedLabels`), the slid lines stay
  plain, and clicking a coloured number opens the panel. Nothing else marks
  the block: the sky ring that highlighted every member 3–8 while the panel
  was open read as an assignment-range leftover and was removed (user
  decision) — the statement in the panel already names the lines involved.
  `anchor` is still sent but unused client-side.
- `matches_current` compares against the members' *relative printed
  order*; chip color (`orderRangeClasses`): emerald = a witness/assignment
  matches, sky = only a conjecture matches, stone = the editor's own
  arrangement (never amber — a legitimate state is not an alarm).
- The presentation is what keeps a printed-order baseline from reading as
  the per-line alarm wall an early design produced: each candidate is ONE
  statement of a MINIMAL MOVE against the printed order
  (`analyzeSequence`: "R2: 8 comes after 2", "12–19 come after 4" —
  shortest lifted run first, neighbour-anchored; a head-of-block move
  anchors on the line printed just before the block via
  `labelBeforeRange`, and "comes before X" appears only when the block
  opens the edition) — never a comma-separated sequence to mentally diff.
  The slope graphs were removed (user decision, "at least for now"); the
  chip's hover title is the joined statements (`orderStatements`, assignment
  order excluded — it is a candidate, never a source). The panel shows ONLY
  disagreement (`panelCandidates`, user decision): no "Sources order …
  differently" header, no assignment-order row, no "X: matches the printed
  order" rows — agreement is no news (a planned feature will show which
  manuscripts accord with the printed text). The one matching row kept is a
  not-yet-followed conjecture, for editors only, so "Record as followed"
  has somewhere to live. The panel opens for READERS too — reading the
  report is not editing (`toggleOrderRange` is ungated; Follow and the
  proposal form stay behind `canEdit`).
- Apply-side: `EditionOrderController::rangeSegmentIds` derives membership
  by sort_key span (not a printed-position slice), and
  `SegmentOrderRewriter::applySequence` permutes members among the
  position slots they occupy, wherever those are — non-members between
  them stay put. `StoreConjectureOrderingRequest` likewise requires
  assignment-contiguity, not printed-contiguity.

Rearranging IS registering a conjecture (user decision, replacing the
marker-based rearrange mode and the server's derived "what did this move
mean"): "Register transposition conjecture" on the edition page turns the
text into a draft of the order — select text and Ctrl+X lifts its whole
text out — whole lines, or WORDS within one line, which divides it
(`onTextCut` → `heldPieces`) — the caret and Ctrl+V sets it down, dividing
the line it lands in (`onTextPaste` → `draftPieces`, merged back by
`mergedPieces` when parts abut again); copy is refused; nothing is saved
meanwhile. The text is rendered as PIECES (`shownPieces`: segment, run
range, part n/m; run spans carry `data-piece-index`, the caret helpers
index pieces), which outside registering are just the segments. Register
submits every difference between the stored order and the draft as ONE
Reordering over the smallest assignment-contiguous stretch covering the
change (`registerPieces`) — `pieces` with `part` and `text` on
`conjecture-orderings.store`, the same shape as a witness's split
assignment, which is how the apparatus reports it (the server builds a
transcript stand-in per such conjecture, `EditionController::
conjectureArrangements`, and the split-assignment report reads it like a
witness, named "Bergk (conjecture)" with `conjecture_id`). Adopting such an
arrangement PRINTS the line in pieces: `ArrangementAdopter` gives the
edition one `EditionSegment` row per part (`part`, `part_text`; part 1
keeps the row, base and lineation, later parts flow on), rejoins lines a
proposal reads whole, resequences the pieces in place
(`SegmentOrderRewriter::applyPieceSequence`) and records the adoption. It
serves every adoption path — the order panel (`edition-order.apply` with a
conjecture), `conjecture-orderings.store` with `follow`, and the line
notice's Adopt button on a divided-line report (`edition-adoptions.store`).
Rows find their runs at render time by matching `part_text` against the
printed text (`EditionController::partRange`); a mismatch leaves the
division stale — part 1 prints the whole line, the page says so. The order
report, `annotateSegmentStatus` and the rewriter's whole-segment moves
treat a divided line as standing at its first part. The editor never
names a kind of transposition — the cut says it (user decision; the
short-lived `word_transposition` conjecture kind was removed for that
reason). There is no silent move
any more: `edition-order.move`, `TranspositionMarks` (working marks, their
pruning and auto-attribution) and `TranspositionValidator` are gone, and
every Transposition/Reordering record — attributed or not — is a source
and candidate for the order report. Removing a record stays a deliberate
act (one-way apply). Tests set up an order with
`SegmentOrderRewriter::moveRange` directly.

A Reordering proposal is authored inside a block's own panel with members
preloaded (`conjecture-orderings.store`, applies and attributes in one
step); a conjecture candidate the printed order already matches offers
"Record as followed" via the ordinary apply endpoint. The standalone
Transpositions form, the post-paste attribution prompt, and
`ReorderingAuthorPanel` were all removed — do not reintroduce an authoring
surface detached from the act it records.

## Lineation is the edition's own display vocabulary
Where an edition's printed text breaks is edition data, never derived from
any manuscript: `EditionSegment.starts_new_line`/`starts_new_paragraph` for
segment boundaries, `EditionLineBreak` (a break before one Lemma column) for
colometry inside a segment — which lyric drama needs, since every edition
divides the lyric parts differently. Verse rendering is all flags set, prose
none; `Editions/Show.vue` renders segments INLINE with every break an
explicit element, so both come from one mechanism.

Editing them works like an editor, not a mode (user decision, replacing the
marker-cycling "Lineation" mode, which was cumbersome): for editors the text
box is a `contenteditable` host whose every word-changing input is refused
(`blockTextEdit` on beforeinput/paste/cut/drop/dragstart), and only Enter,
Backspace and Delete mean anything — they act on the gap at the caret's word
boundary (`caretPosition` → `gapBeforeRun`/`gapAfterRun`), raising or
lowering it through none → line → paragraph via the two existing endpoints,
then `placeCaret` restores the caret after the re-render. Chips, markers and
open notices inside the box are `contenteditable="false"` islands: events
from inside them are ignored by the text handlers (`inEditableIsland`), so
forms in a notice keep working. Readers get the plain text with focusable
words (`onRunKey`); editors navigate with the caret instead. Keep the
data attributes the caret logic reads (`data-segment-id`/`data-run-index` on
runs, `data-spacer-*` on the spaces between them).

Seeding (`LineationSeeder`, called from `SegmentAdder::add`/`addAssignments`)
copies the base transcription's newlines ONCE at add time — one `\n` in a
gap → line, two → paragraph; gaps across a discontinuous assignment's part
boundary seed nothing (physical displacement, not whitespace). From then on
the lineation is edition-owned; the invariant that manuscript newlines mean
nothing to the work stands.

`edition_line_breaks.lemma_id` **cascades**, deliberately NOT copying
EditionComment's `nullOnDelete`: a break with no column means nothing, there
are no words to preserve. The safety comes from the other side — breaks
count as editorial content in BOTH `SegmentAligner::hasEditorialContent` and
the emptying-column check inside `realignLayer`, so no collation rebuild can
fire the cascade; only explicit editor action removes a break. When adding
any new lemma-anchored record, extend both checks or pick nullOnDelete —
never cascade without pinning.

`break_before` on a run is resolved inside the run walk
(`EditionController::withBreaks`), not against the raw column list: runs skip
columns a range selection or wider base reading covers, and a break on a
swallowed column folds onto the covering run.

## Paratext has a place in the text and nothing else (user request, 2026-09-13)
`EditionParatext` is what an edition prints beside or among the words
without its being text of the work — a marginal note, an inline remark, a
speaker's name in a dialogue. It changes no reading, enters no apparatus
and is never collated. It stands at a point BETWEEN words: `placement`
'before' or 'after' the column `lemma_id` of `segment_id`, several at one
point in `position` order. `lemma_id` CASCADES and the paratext PINS the
column (added to `hasEditorialContent` and `realignLayer`'s emptying
check, like a line break); removing the segment from the edition removes
its paratexts (`EditionSegmentController::destroy`), and the page warns
before that with `paratextLossNote`/`confirmParatextLoss`. Kinds
(`ParatextKind`): left_margin, right_margin, inline, speaker. How SPEAKER
indications are set is ONE choice for the whole edition
(`editions.speaker_display`, `SpeakerDisplay`: inline;
line_start_margin — left margin at a printed line's beginning, inline
elsewhere; own_line; own_line_centered), changed through
`editions.update`. `EditionController::paratextsOf` resolves each to the
run covering its column, exactly as `withBreaks` does for breaks, and
ships `run_index` + `placement` on `WindowSegment.paratexts`.
`EditionCopier` copies them (and the layout column). Routes:
`edition-paratexts.store/update/destroy`.

## Editorial notes are free text, and deliberately so
`EditionComment` carries what the apparatus's own vocabulary cannot: that two
manuscripts differ in accentuation, breathing or word division in a way worth
reporting rather than silently normalizing; which speaker a line belongs to in
a dialogue; why this edition prints what it prints. Do not replace it with a
typed vocabulary — these are matters of judgment, and prescribing terms for
them would be prescribing the scholarship.

Scoped to one `Edition`, like `EditionLemma`: two editions of a work can say
different things about the same word. A note always names a
`Segment`; `lemma_id` (+ `range_end_lemma_id`) optionally narrows it
to a column or span, following LemmaReading's convention that the range end
carries a value only when more than one column is genuinely covered. With
`lemma_id` null the note is about the segment as a whole, which is what a
speaker assignment usually is.

The lemma foreign keys are `nullOnDelete`, not cascading: if columns are ever
rebuilt the note must survive, degrading to a segment-level note rather than
being destroyed. A scholar's own words are never collateral damage. A note
*anchored to a column* nonetheless counts as editorial content and blocks a
rebuild (see `hasEditorialContent`), since the editor chose that column.

Only the wording is editable. Moving a note to another segment or column is
not an edit but a different note.

Presentation (user decision): a line's notes are READER-FACING and live in
the notice the line number opens — never rendered between the lines (the
old `canEdit`-gated inline block hid them from readers entirely and is
gone). The shared notes section renders inside the popover for the
`notes`, `discontinuity` and `order_range` kinds, so one press shows
everything the line has to say; a segment with notes and no other report
gets the `notes` kind (sky chip). Edit/delete/reword stay behind `canEdit`;
writing a NEW note happens via the "+ Note" composer at the bottom of every
popover — anchored to the open run/range, or whole-line from a
number-opened notice. For editors every number is such an entry point
(user decision): pressing a plain line's number opens the notes notice so
a whole-line note needs no variant site to exist.

## Reading through to the manuscripts
`DiplomaticCounterpart` gives what a witness physically has where its
normalized text reads something. The two layers are separate transcriptions
with separate offsets and may differ in every character, so there is no
mapping by position — only by **token index**, which holds whenever both
layers divide the segment into the same number of words. That is the ordinary
case, since the normalized layer is made by copying the diplomatic one and
regularizing it in place.

Where the counts differ (a crasis resolved, a word divided differently) it
returns null rather than guessing: showing the wrong manuscript reading would
be worse than showing none. The line as a whole is still given, since only the
word-by-word correspondence is untrustworthy.

A conjecture never has a counterpart — no manuscript attests it.

`EditionController::show` preloads each witness's diplomatic layer keyed by
witness, visibility-filtered, and passes the work's `Tokenization` down rather
than reading it off a segment (the eager-loaded `segment` carries a
narrow column list and has no `work`). The toggle in `Editions/Show.vue` is
available to every reader, not only editors — seeing what the manuscripts have
is reading, not editing.

## A difference made in normalizing is not a manuscript variant
Where the witnesses' normalized readings differ but their diplomatic layers
agree, the difference did not arise in the tradition — it arose in
normalizing, one witness given an accent or pointing another was not.
Reporting it as a variant attributes to the scribes a decision the editor
made. `differsOnlyInNormalization()` in `Editions/Show.vue` detects it (only
witnesses whose manuscript reading is actually known count, and two are needed
before "the manuscripts agree" means anything) and the tooltip says so plainly,
so it can be corrected rather than printed.

This is a real trap, not a hypothetical: the seeded edition originally carried
exactly such a false variant — A normalized σφωε to σφῶε and B was left
unaccented, while both manuscripts write σφωε.

The hover NOTICE about it ("The manuscripts agree here — this difference
was made in normalizing…", `differenceProvenance`/`manuscriptEvidence` in
lib/apparatus.ts) was REMOVED on 2026-09-13 (user decision: superfluous,
and it read as though a difference between the two layers counted as a
variant). Variant detection is unchanged — normalized readings only — and
`orthographic_variation` is still sent; only the sentence is gone. Do not
bring the notice back.

Where the manuscripts *cannot* be consulted — an edition with no diplomatic
layers, or fewer than two witnesses having one — a difference of accent,
breathing or pointing is still not attributable to them. Collation reads the
normalized layer and those marks are supplied there, so such a difference
belongs to the editor until a diplomatic layer shows the scribes differing.
`EditionController::orthographicVariation` marks a site where *every*
difference folds away under `GreekText::foldOrthography`; the client's
`differenceProvenance()` combines it with the manuscript evidence and says
which of the three cases holds. A site mixing an orthographic difference with
a real one is not marked: it is a genuine variant site.

## Apparatus candidates have a defined order
`EditionController::materializedCandidates` sorts: the base's own reading
first, then other witnesses by siglum, then conjectures oldest first. Left
unsorted, candidates come out in the order the witnesses were aligned, which is
incidental rather than evidence.

## The edition page is two panes, and there is no mode
`Editions/Show.vue` always renders the edition on the left and the Witnesses
pane on the right (`WitnessesPanel.vue`, the former add pane and manuscripts
pane merged — user decision; the pane choice row is gone). The manuscripts
used to be interlinear — diplomatic text printed under each word — which
read as clutter and is gone; `run.diplomatic` survives only in the hover
tooltip and the apparatus popover. Editing affordances still fold `canEdit`
into every render test (as the lacuna markers do with
`canEdit && lacunaMode`): a choice records an intention, and permission is
re-checked at render. The pane's text is NOT in the page's own response:
`witnessPane` is an `Inertia::optional` prop the pane asks for itself
(`EditionController::witnessPane`; see "The witnesses pane is fetched on
demand" below) — see also "Adding and removing text" below.

## A witness has transcriptions; a transcription has two layers
`Transcription` is the named thing an editor creates on a witness, and it
consists of exactly two `TranscriptionLayer` rows — diplomatic and normalized.
A witness may hold any number of transcriptions: a manuscript can carry texts
belonging to different works, or several kinds of text across the same pages.
Nothing records what kind of text a transcription holds or which is principal;
the editor names them, and an edition reaches one through the assignment
assignments on its normalized layer.

The `transcription_layers` table is the old `transcriptions` table renamed — a
row there always was one layer, and every FK to it (assignments, regions,
`lemma_readings`, `edition_segments`, the tag pivot)
still means a layer, now spelled `transcription_layer_id`.

`visibility` is on the **transcription**, not the layer. A transcription is
public or it is not, and if it is, both of its layers are. Holding it per layer
encoded an assumption that does not hold — that a diplomatic layer is somehow
more provisional than the normalized one — when which layer is written first is
simply how the editor chooses to work. For the same reason, nothing assumes
what kind of text an import contains: the editor names the layer it goes into.

A normalized layer's diplomatic counterpart is its **sibling** — key by
transcription, never by witness. `EditionController` keys `$diplomaticLayers`
by `transcription_id` for exactly this reason: with a witness transcribed
twice, keying by witness lets one transcription's diplomatic layer silently
answer for another's, and the two are different texts.

**Copying** a layer, not forking — "fork" came from the one-slot model. The
destination transcription is the only choice; the layer follows from it
(`TranscriptionLayer::destinationLayerIn`): within its own transcription there
is just the other layer, and any other transcription receives the corresponding
one. What travels with the text depends on whether it still describes the same
physical document — inside the transcription the assignment assignments *and* the
image regions come, since the other layer is the same manuscript text
regularized; into another transcription only the assignments do, because which
segment of a work a stretch of text is stays true wherever it goes while where
it sits on a page does not. Copying over a layer that already has text is
refused: it would take that layer's spans, regions and collated readings with
it.

In tests, `TranscriptionLayerFactory::for($witness)` still works: it is
overridden to mean "a layer of a transcription of this witness". Two such calls
make two *separate* transcriptions, so a test that needs both layers of one
must create the parent and pass it to both. `->published()` on a layer factory
publishes its transcription, which is what publishing a layer now means.

## The whole-edition reports are cached under a fingerprint (2026-09-14)
`orderRanges` and the witnesses' split-line report (`witnessDiscontinuities`)
are derived over every witness × every line of the edition on each page
load, while the page shows one window — 65 ms of a 390 ms page for six
witnesses of 300 lines, seconds for twenty witnesses of thousands. Both
now come from `wholeEditionReports`: `Cache::remember` under
`edition-reports:{edition}:{fingerprint}`, 7 days, where
`reportFingerprint` is xxh3 over EVERYTHING they read — the printed rows
(segment, part, base, label, sort key), each visible layer (siglum,
xxh3 of its text, every assignment's id/segment/part/span) and two
aggregate queries over the work's ordering conjectures and their entries
(count, max id, max updated_at). A change makes a NEW key; nothing is
invalidated by hand and there is no `Cache::forget` anywhere — do not add
one, add the missing input to the fingerprint instead (the only known
gap: a raw DB write that bypasses timestamps and changes only a
conjecture's wording). The window's conjectural arrangements are NOT
cached — they depend on the window and are one cheap query — and are
merged per page by `withArrangementDiscontinuities`. Tests:
EditionReportCacheTest (a warm load runs fewer queries; every input
change is seen at once, including a same-length word change inside an
assignment that moves no offset).

## The order report and the lacuna anchor are derived over the WHOLE edition
`EditionController::orderRanges` runs over `$orderedSegments`, keyed by
printed index and read back through the page offset — a witness moving a
line across the fifty-segment page boundary used to produce no marker at
all (test-pinned: "a disagreement straddling the page boundary"). Each
window segment also carries `previous_edition_segment_id` from the whole
order, so the whole-line-lacuna marker on page 2's first line anchors
before it, not at the edition's start.

`windowContext()` loads comments, unplaced conjectures, columns with
readings, selections and line breaks ONCE per window and hands them to
`segmentDetail`/`materializedRuns`/`withBreaks` grouped; do not reintroduce
per-segment queries there.

Presentation notes (user decision, all three): "Delete edition" confirms
like every other delete; the line-number chip is a real `<button>` and runs
are focusable (`tabindex`/`role="button"`, Enter/Space open, focus shows
the apparatus) so the reports are reachable without a mouse; the hover
apparatus is clamped to the viewport and flips above the word near the
bottom. The pure helpers live in `lib/orderReport.ts` (`analyzeSequence`)
and `lib/apparatus.ts` (readings, provenance, discontinuity statements),
with the payload types in `types/edition.ts`; `Editions/Show.vue` keeps the
state and the template. A "Go to line" form jumps to a label on any page.
`WitnessesPanel` keys its witness pulldown by `witness_id`, never by siglum —
sigla are conventional per work and two witnesses called B already exist.

## A line's order notice speaks only about that line; proposals may be recorded unfollowed
`panelCandidates`/`orderStatements` in `Editions/Show.vue` list a
disagreeing source only where its minimal move (`analyzeSequence().movedLabels`)
includes the pressed line: in a block 3–8 where R2 moves 3 and R moves 8,
line 3 says "R2: 3 comes after 8" and line 8 says "R: 8 comes after 7",
never both on each (user decision). A matching not-yet-followed conjecture
still shows on every member, since it moves nothing and "Record as
followed" needs a home. `conjecture-orderings.store` takes `follow`
(default true): "Record only" catalogues the Reordering as a candidate
without applying or adopting it — a published proposal the editor rejects
still belongs in the apparatus.

## The line notice: provenance on top, then Variants, References, Notes
Every line number opens ONE notice (`kind: 'line'`), for readers and
editors alike (user decision). Its top says what the line rests on
(`provenanceLines`): "Based on R. Also present in R2." (witnesses from
the `transcriptions` prop's assignments), or "Proposed by Bergk" for a line
no witness has (the selected conjecture); then, only when the block's
printed order follows something other than the base text, "Ordering based
on R2" / "Ordering based on Bergk's proposal" / "Ordering by this
edition". Then headings, each only when there is something: VARIANTS
(order statements scoped to the line, Follow and the proposal draft for
editors, split-assignment statements), REFERENCES (the segment's own
assignments, picker for editors), NOTES (comments and the composer).
Assignments of a CONJECTURE are never printed in the notice or the
candidate list or the hover apparatus: a conjecture's name is a button
that opens, in place, the edit form (`ConjectureForm`, fed by the
`workConjectures`/`workSegments` props from `ConjectureCatalogue`) for
editors and its literature for readers. The old kinds `order_range`,
`discontinuity` and `notes` are gone; do not bring back per-kind notices.

## Adding and removing text (user decision, 2026-09-09)
The Witnesses pane (`WitnessesPanel.vue`) shows a witness WHOLE, in either
layer, with every assignment; assignments the edition has print grey
(`AlignableText` `unavailableAssignmentIds`, no strikethrough). "Add selection"
posts the assigned segments fully inside the selection by id
(`edition-segments.store` with `segment_ids`, the layer being the
diplomatic entry's normalized sibling). An assignment lands where its
manuscript has it — after the last edition segment preceding it in its
own witness's physical order, else by numbering order
(`SegmentAdder::insertionPosition`, then
`SegmentOrderRewriter::renumberEdition`) — so adding never creates an
arrangement that needs a transposition conjecture; the editor registers
one from the edition text if she wants another order. Removing: a
selection in the edition text reaching into several segments opens the
remove box for all of them; within one segment the conjecture box opens
and offers "Remove segment from edition" too (`edition-segments.destroy`
takes `segment_ids`). There is no add/remove mode and no pane
choice any more; adding is locked while a transposition is registered.

## The witnesses pane is fetched on demand, one witness, a run of pages (2026-09-14)
The edition page used to send every layer of every witness of the work,
whole (`witnessTranscripts`), and every action rebuilt it: the payload
scaled with the corpus, not with what was read. Now `witnessPane` is an
`Inertia::optional` prop (never in a full response) that
`WitnessesPanel.vue` asks for with `router.reload({ only: ['witnessPane'],
data: { witness, witness_page } })` — after its mount (in a `nextTick`, so a
pane the page puts away at once from a remembered preference asks for
nothing), when the witness pulldown changes (the list comes from the
page's `witnesses` prop), when a step is taken through the pages, and
whenever a full visit (a page jump) has dropped the prop. The choice lives
in the URL's query, so the actions that follow keep it; `witness` is read
from the URL once mounted, never at setup (hydration).
`EditionController::witnessPane` sends the witness asked for (else the
first by siglum; a witness the viewer may not see falls back likewise) in
both layers, each transcript cut by `sliceOf` to `PANE_PAGES` (3)
manuscript pages from the page asked for — else the page where the
witness has the first segment of the edition's window (`pageOfWindow`),
so the pane opens beside the text being read; the text before the first
break counts with the first page, and the line break before a slice's end
is dropped. EVERY offset in an entry is the slice's own (`slicedTranscript`
rebases and clips assignments, page breaks and regions; `slice.start`
says where it stands in the layer's full text): the pane shifts the
edition's hovered spans by `slice.start` before matching regions and
shifts a region's span back when it emits one. Part ordinals and totals
are the whole layer's. `slice.previous_page_id`/`next_page_id` step a
whole run at a time (no overlap); `transcribed_page_ids` says which of the
witness's pages a transcript starts somewhere, so the text view's pager
(below the text, keeping the frames' tops aligned) and the image view's
page choice ask only for pages that exist in a transcript. Until the
chosen witness's own pages arrive the pane shows a pulsing skeleton; a
further run of the same witness dims the text it has. A transcript
without breaks comes whole (`slice.whole`, no pager).
`TranscriptionLayer::offsetsOfLines` resolves every break in one pass
(`offsetOfLine` per break walked the text once per page). Tests:
WitnessTranscriptPaneTest fetches the prop as the pane does (a partial
request with the page's `X-Inertia-Version`, or the 409 conflict answers).

## Runs and candidates travel slim (2026-09-14)
`EditionController::slimRun` strips every run and candidate field that is
at its default (`RUN_DEFAULTS`, `CANDIDATE_DEFAULTS`: nulls, falses, empty
`references`), drops a candidate's `key` (always `reading:` + id) and a
`diplomatic` equal to the `text` (a NULL `diplomatic` stays — the
manuscript's spelling unknown is not the same as "as the text"). On a
ten-line, three-witness page this took `windowSegments` from 113 KB to
45 KB and the page from 134 KB to 66 KB (measured 2026-09-14). The client
restores the full shape ONCE — `inflateSegment`/`inflateRun`/
`inflateCandidate` in `lib/apparatus.ts`, mirrored field for field to
the PHP defaults; keep them in step — in the `windowSegments` computed of
`Editions/Show.vue`; the prop is typed `WireWindowSegment[]` and nothing
else on the page may read `props.windowSegments`. Feature tests assert a
defaulted field with `->missing(...)` or `?? false`, never `->where(..., false)`.
A new candidate or run field with a default goes in BOTH lists or it is
sent every time.

## Every action on the edition page is a partial reload (2026-09-14)
All 28 `router`/`useForm` calls in `Editions/Show.vue` and the two adds
in `WitnessesPanel.vue` name the props they can have changed
(`TEXT_PROPS`, `SEGMENT_PROPS`, `WINDOW_PROPS`, `EDITION_PROPS`,
`ACCESS_PROPS` at the top of the script; `ADD_PROPS` in the pane) —
registering a conjecture no longer rebuilds the access panel, the
bibliography form or the witnesses pane, and a note refreshes the window
alone. `errors` always comes; `flash` is in every list (it is shared, not
`always`, so a partial reload without it drops the message). `witnessPane`
is in no list: nothing done on the page changes a manuscript, and the
pane keeps what it has. Only `copyEdition`/`removeEdition` (navigations
away) and the page jumps (full visits, after which the pane re-asks for
itself) are not partial. A new action MUST name its props, or it silently
refetches everything.

## The witnesses pane's pages and image view (user decision, 2026-09-09)
`EditionController::pageBreaksOf` and `witnessPages` send, per transcript
entry, the page breaks resolved to that layer's own offsets (then rebased
to the slice, see above) and the witness's pages with their visible
photograph (`ManuscriptImage::visibleTo`). `AlignableText` draws a page-break line
with the page's label before the chunk starting at each break
(`pageBreaks` prop; markers carry `data-page-id`). In `WitnessesPanel` the
text scrolls inside the pane (`max-h-[70vh]`), and the last marker that
has scrolled past the top edge is the page the Facsimile tab opens on
(`trackPageAtTop`); the image view has its own page selector and arrows,
and the layer buttons return to the text with that page's first line at
the top (`showText`; there is no separate "Text" link — user decision). A
page without a photograph says so; the viewer is the shared
`ManuscriptImageViewer`. Each entry also carries the layer's image
`regions` (with `group_id`): the coupling is WORD-LEVEL, as in the
transcript editor (user decision). A box is one mapping in both layers
(counterpart rows share a group, see SiblingSync); the edition's columns
carry normalized offsets — a run's `base_start/base_end` and each
candidate's own witness offsets (`witnessSpansOf` in `Editions/Show.vue`)
— so a box is matched through its normalized row and lit in both rows
(`regionGroups`/`highlightedRegionIds` in `WitnessesPanel`), and the box
under the pointer lights the runs whose spans overlap it
(`hover-image-region` → `onImageRegionHover` → `imageLitRunKeys`, amber in
`runClasses`). A box mapped on the diplomatic layer alone (drawn while the
layers were out of step, not healed) falls back to the whole line via its
assignment. Resolution is the column: a sub-word box lights the word.

## Omissions are readings; a deletion is a conjecture by nothing (user decision, 2026-09-09)

- `SegmentAligner::recordOmissions` runs at the end of `collate()` and
  `realignLayer()`: for every witness aligned into a segment, one
  zero-width `lemma_readings.omitted = true` reading per maximal run of
  columns it lacks, anchored at the witness's own offset where its words
  resume (end of its last word before the run, else start of its first
  after) and spanning the run via `range_end_lemma_id`. Columns no witness
  attests (lacuna / conjecture-only) break a run — an omission adopted
  across them would swallow the lacuna. Upsert by anchor column; a stale
  omission an edition selects is left standing (the editor's decision).
  `php artisan collation:record-omissions` backfills.
- Anything that reads a witness's "real" readings must skip omitted ones:
  `representativeText` (consensus), `realignLayer`'s empty-column check,
  `EditionController::baseReadingOf`/`witnessExtension`,
  `EditionVariantController::baseReadingAt`, `LineationSeeder`. The text
  editor's `applyReadings` shifts an omission like a point and never
  tombstones it. A tombstone (zero-width + `needs_review`) is a different
  thing and the two must stay distinguishable — hence the column, not a
  heuristic on width.
- Candidates and runs carry `omitted`: a witness omission or a Deletion
  conjecture has `text ''` and `omitted true`; the client says "omitted" /
  "deleted" in words (`candidateText`), groups omitting witnesses as one
  apparatus line, and counts an omission as a real disagreement in
  `hasVariation`. A run prints the discreet marker `‸` wherever nothing is
  printed on purpose (`run.omitted`: the base lacks the words, or an
  omission/deletion was adopted); `⟨insert⟩` stays for a column that has
  nothing yet. The base's omission of several columns is one gap run
  (`materializedRuns` jumps its range like the base's wider reading).
- `ConjectureType::Deletion`: `text` always null; placed exactly like a
  substitution (`placement=range`, catalogued unless `adopt`,
  `isNewSubstitution` covers both); the span popover's "Delete these
  words" checkbox disables the text box and sends `conjecture_type:
  deletion`. Picking a witness omission posts its zero-width offsets —
  `end_offset` is `gte`, and `validateTranscriptionSpan` only accepts an
  empty span when an omitted reading sits at exactly that offset.
- Labels are full words, never abbreviations (user decision — space is not
  scarce in a digital edition): "Bergk (conjecture)", "Wolf (lacuna)",
  "Bentley (supplement)", "Bergk (deletion)", "Ordering by Bergk
  (conjecture)"; Work page `TYPE_LABELS` likewise. Never "Not in X" for
  whole segments a witness lacks — the witness lists already say which
  segments each witness has, and works with many fragmentary witnesses
  would drown in it.

## The edition page's time is bounded too: index what is read per word (2026-09-14)
Measured on a 300-line, six-witness edition (fifty-line window): the page
went 650 ms → 350 ms by fixing two things that grew with the WITNESS,
not the window. (1) `DiplomaticCounterpart::assignments` filtered a
layer's whole assignment list (hundreds) on every first touch of a
(layer, segment) — 600 touches a page, twice each; it now groups a layer
instance's assignments by segment once (`$assignmentsBySegment`, a
WeakMap like the token cache). (2) `mb_substr` by character offset is
linear in the offset, so slicing a word deep in a witness of hundreds of
pages cost the whole text — and the page slices a word for every reading
of every column (a fifty-line window took 4× longer with 95 K characters
before it). `WordDivision::slice` (used by `wordText`, `asWritten` and
`Tokenizer::whitespace`) keeps, per long text (≥ 4096 bytes), an index
of byte offsets every 256 characters, found by a fingerprint of the
string (length + CRC of its ends, then `===`, pointer-equal for a model
attribute) and reads only the window it needs. Use `WordDivision::slice`,
never a bare `mb_substr`, on a layer's text at an offset. Unit-tested
against mb_substr across checkpoints and a fingerprint collision.

## The edition page's queries are bounded: load what the counterpart reads (2026-09-14)
`DiplomaticCounterpart::tokens` reads a layer's assignments of the segment
for EVERY word and EVERY candidate, and uses the loaded relation only when
there is one — unloaded, each call is a query. Production showed 1056
queries and 5.8 s on one edition page (read off the `LogSlowRequests`
line). So `EditionController::show` eager-loads the work's assignments on
the edition segments' base layers AND `windowContext` loads them on every
reading's layer (`readings.transcriptionLayer.assignments`), and
`ConjectureCatalogue::forWork` takes its delete-impact counts with
`withCount` and the already-loaded adoption/selection groups rather than
five queries per conjecture. `EditionPageQueryCountTest` pins it: ten
lines cost at most a dozen queries more than two. When adding a relation
the counterpart or the catalogue reads, load it with the rest.
`DiplomaticCounterpart::tokens` also caches its tokens per layer INSTANCE
and segment in a `WeakMap` for the length of a request — asked for every
word and candidate, it re-tokenized the same lines each time (two thirds
of the page's CPU in profiling). Keyed by instance, never by id, so a
fresh request or a test reusing an id sees the current text
(test-pinned in DiplomaticLayerViewTest).
