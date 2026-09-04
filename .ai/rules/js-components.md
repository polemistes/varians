---
paths:
  - 'app/Models/{Transcription,TranscriptionSegment,TranscriptionRegion,Witness}.php,app/Http/Controllers/Transcription*.php,app/Http/Controllers/WitnessController.php,resources/js/pages/Transcriptions/**,resources/js/pages/Witnesses/**,resources/js/components/AlignableText.vue'
---

# Js Components

## Transcription text is continuous; segments/regions are span annotations, not input units
A `Transcription` owns one continuous `text` field (the whole diplomatic-order document, in the physical order the scholar typed it while reading the manuscript). Segmentation is NOT part of input.

The tags system (Tag model, `tag_transcription_layer` pivot, the whole tag UI) was REMOVED, deliberately (user decision): a transcription's *name* says what it is. The diplomatic/normalized distinction is `Transcription.layer`, a real structural column, because it decides what enters the apparatus. See `.ai/rules/edition.md`. Do not reintroduce tags.

**A witness IS its physical carrier.** The witness `type` and the separate `Manuscript` model are both gone (user decision): every witness carries repository, shelfmark, date_text and description directly, all optional — a collection of readings from the Suda simply leaves the shelfmark empty — and pages/photographs hang off the witness. The old `Manuscript.notes` content became `Witness.description`. On the witness page, everything witness-scoped (identity, date, location, Show description, Edit/Delete witness, Add transcription) lives in ONE `fieldset` whose `legend` says "Witness" — the same device will mark the edition editor, so the user always knows which editor she is in.

`TranscriptionSegment` (citation spans) and `TranscriptionRegion` (image-alignment spans) both own no text of their own — they're `{start_offset, end_offset}` annotations directly over `Transcription.text`, created by selecting a range in the rendered view (see `AlignableText.vue`'s `select`/`badge-click` events, orchestrated in `Transcriptions/Editor.vue`). They're independent dimensions of the same text — a citation span and an image region needn't share boundaries. Physical reading order is simply a span's offset in the string; no manual `position` field exists anymore for either.

**Editing already-annotated text**: `TranscriptionController::update()` diffs old vs. new text (`App\Support\Transcription\SpanRebaser` — longest common prefix/suffix) on every save. Spans entirely before or after the single changed region are left alone or silently shifted by the length delta; spans overlapping the changed region get `needs_review = true` and their offsets are left untouched (not auto-corrected) for a human to re-confirm via the editor's flagged-badge UI. This only reasons about one contiguous edit per save — several disjoint edits in one save over-flag the untouched text between them (safe direction to be wrong).

Do not reintroduce per-segment `text`/`position` columns — deliberately removed in favor of this model.

The old transcription `type` column was removed too, but has since returned in a narrower, structural form as `layer` (diplomatic/normalized). That reversal is intentional — see `.ai/rules/edition.md` for why — so do not undo it.

**The layer-copy flow is RETIRED** (controller, page, routes deleted; user decision): starting one layer from the other is the mirror's job (import/paste fills both), cross-witness copying is the clipboard paste-carry (citations travel, mappings stay home). In its place each transcript pane has a "Mirror layer operations" checkbox (default ON, deliberately not persisted): off, saves send `mirror: false` and the sibling is left entirely alone — the bootstrapping mode, filling each layer from a different source (e.g. copying both layers of an old witness to a new one, one at a time).
