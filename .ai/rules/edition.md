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

## Apparatus candidates have a defined order
`EditionController::materializedCandidates` sorts: the base's own reading
first, then other witnesses by siglum, then conjectures oldest first. Left
unsorted, candidates come out in the order the witnesses were aligned, which is
incidental rather than evidence.
