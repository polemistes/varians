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
overwriting citation spans, image regions and collated readings.

Only normalized transcriptions enter the apparatus (`PassageAdder::materialize`
filters via `whereRelation('transcription', 'layer', ...)`, mirrored by the
`Transcription::collatable()` scope used in `EditionController::show`) and only
they may be an edition's base or a witness-sourced `LemmaReading` (guarded in
`StoreEditionPassageRequest`, `StoreEditionPassagesBulkRequest`,
`StoreEditionVariantRequest`). Without that filter a fork — which copies
citation segments verbatim — makes a manuscript appear in its own apparatus
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
A passage's `Lemma` columns are shared across every edition of the work, so
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
`PassageAligner::collate` is the entry point; `alignWitness` is the per-witness
step and should not be called directly outside it (tests aside).

Three things make the result independent of how an editor happened to work:

1. Witnesses align in **siglum order** (`collate`) — the conventional apparatus
   order and the only key derived from the evidence. Not `transcription_id`,
   which is creation order.
2. `representativeText` sorts a column's readings before choosing a consensus —
   `readings` is a bare `hasMany`, so an unsorted `first()` rests on storage
   order.
3. While a passage is still nothing but aligner output, `collate` **deletes the
   columns and rebuilds** from all witnesses at once. Ordering alone does not
   cover a witness cited after the passage was collated that sorts before the
   ones that built it.

`hasEditorialContent` gates the rebuild: any reading with a `conjecture_id` (a
placement whose column is its only record — this also covers lacuna columns) or
any `EditionLemma` (an edition's decision, and since every
`EditionVariantController::store` path upserts one, this catches hand-placed
witness readings too, which are otherwise indistinguishable from aligner
output). Once either exists the passage appends instead, which is correct: its
structure is settled and should grow, not churn.

**Tests that assert column structure must pin witness sigla.** Factory sigla
are random, so leaving them makes the seed witness — and therefore the
structure — a coin flip. `editionWithBase()` pins "A" for the base and "B" for
the second witness for this reason.

## Editorial notes are free text, and deliberately so
`EditionComment` carries what the apparatus's own vocabulary cannot: that two
manuscripts differ in accentuation, breathing or word division in a way worth
reporting rather than silently normalizing; which speaker a line belongs to in
a dialogue; why this edition prints what it prints. Do not replace it with a
typed vocabulary — these are matters of judgment, and prescribing terms for
them would be prescribing the scholarship.

Scoped to one `Edition`, like `EditionLemma`: two editions of a work can say
different things about the same word. A note always names a
`CanonicalPassage`; `lemma_id` (+ `range_end_lemma_id`) optionally narrows it
to a column or span, following LemmaReading's convention that the range end
carries a value only when more than one column is genuinely covered. With
`lemma_id` null the note is about the passage as a whole, which is what a
speaker assignment usually is.

The lemma foreign keys are `nullOnDelete`, not cascading: if columns are ever
rebuilt the note must survive, degrading to a passage-level note rather than
being destroyed. A scholar's own words are never collateral damage. A note
*anchored to a column* nonetheless counts as editorial content and blocks a
rebuild (see `hasEditorialContent`), since the editor chose that column.

Only the wording is editable. Moving a note to another passage or column is
not an edit but a different note.

## Reading through to the manuscripts
`DiplomaticCounterpart` gives what a witness physically has where its
normalized text reads something. The two layers are separate transcriptions
with separate offsets and may differ in every character, so there is no
mapping by position — only by **token index**, which holds whenever both
layers divide the passage into the same number of words. That is the ordinary
case, since the normalized layer is made by copying the diplomatic one and
regularizing it in place.

Where the counts differ (a crasis resolved, a word divided differently) it
returns null rather than guessing: showing the wrong manuscript reading would
be worse than showing none. The line as a whole is still given, since only the
word-by-word correspondence is untrustworthy.

A conjecture never has a counterpart — no manuscript attests it.

`EditionController::show` preloads each witness's diplomatic layer keyed by
witness, visibility-filtered, and passes the work's `Tokenization` down rather
than reading it off a passage (the eager-loaded `canonicalPassage` carries a
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

## The edition page is two panes; a mode is not a permission
`Editions/Show.vue` always renders the edition on the left and one chosen view
on the right (`rightPane`: add/remove text, the manuscripts, and images once
witness image handling exists). The manuscripts used to be interlinear —
diplomatic text printed under each word and under each line, behind a "Show the
manuscripts" toggle. That read as clutter inside the text rather than as a
manuscript, and it is gone; `run.diplomatic` survives only in the hover tooltip
and the apparatus popover.

Which pane *renders* is `activeRightPane`, which folds `canEdit` into the
stored choice, exactly as the lacuna markers test `canEdit && lacunaMode`. Keep
that shape. When the add-text panel was gated on its own mode alone, an editor
who opened it and then switched to reader view kept an editing panel open on a
page that had just hidden the toolbar which would have closed it — the mode
recorded an intention, and nothing re-checked permission at render.

`EditionController::windowSlice` trims each transcript to the stretch its cited
segments occupy within the displayed passages and rebases the segment offsets
onto that slice. Rebasing is not cosmetic: `AlignableText` discards any segment
whose `end_offset` runs past the text it was given, so an unrebased segment
silently disappears rather than rendering in the wrong place. Only segments
lying wholly inside the slice are sent, for the same reason.

## A witness has transcriptions; a transcription has two layers
`Transcription` is the named thing an editor creates on a witness, and it
consists of exactly two `TranscriptionLayer` rows — diplomatic and normalized.
A witness may hold any number of transcriptions: a manuscript can carry texts
belonging to different works, or several kinds of text across the same pages.
Nothing records what kind of text a transcription holds or which is principal;
the editor names them, and an edition reaches one through the citation
segments on its normalized layer.

The `transcription_layers` table is the old `transcriptions` table renamed — a
row there always was one layer, and every FK to it (segments, regions,
`lemma_readings`, `edition_passages`, `edition_passage_orders`, the tag pivot)
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
physical document — inside the transcription the citation segments *and* the
image regions come, since the other layer is the same manuscript text
regularized; into another transcription only the citations do, because which
passage of a work a stretch of text is stays true wherever it goes while where
it sits on a page does not. Copying over a layer that already has text is
refused: it would take that layer's spans, regions and collated readings with
it.

In tests, `TranscriptionLayerFactory::for($witness)` still works: it is
overridden to mean "a layer of a transcription of this witness". Two such calls
make two *separate* transcriptions, so a test that needs both layers of one
must create the parent and pass it to both. `->published()` on a layer factory
publishes its transcription, which is what publishing a layer now means.
