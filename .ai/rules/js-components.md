---
paths:
  - 'app/Models/{Transcription,TranscriptionSegment,TranscriptionRegion,Tag}.php,app/Http/Controllers/Transcription*.php,resources/js/pages/Transcriptions/**,resources/js/components/AlignableText.vue'
---

# Js Components

## Transcription text is continuous; segments/regions are span annotations, not input units
A `Transcription` owns one continuous `text` field (the whole diplomatic-order document, in the physical order the scholar typed it while reading the manuscript) plus free-form `tags` (many-to-many, scholar-defined vocabulary — no fixed "diplomatic/normalized" enum). Segmentation is NOT part of input.

`TranscriptionSegment` (citation spans) and `TranscriptionRegion` (image-alignment spans) both own no text of their own — they're `{start_offset, end_offset}` annotations directly over `Transcription.text`, created by selecting a range in the rendered view (see `AlignableText.vue`'s `select`/`badge-click` events, orchestrated in `Transcriptions/Editor.vue`). They're independent dimensions of the same text — a citation span and an image region needn't share boundaries. Physical reading order is simply a span's offset in the string; no manual `position` field exists anymore for either.

**Editing already-annotated text**: `TranscriptionController::update()` diffs old vs. new text (`App\Support\Transcription\SpanRebaser` — longest common prefix/suffix) on every save. Spans entirely before or after the single changed region are left alone or silently shifted by the length delta; spans overlapping the changed region get `needs_review = true` and their offsets are left untouched (not auto-corrected) for a human to re-confirm via the editor's flagged-badge UI. This only reasons about one contiguous edit per save — several disjoint edits in one save over-flag the untouched text between them (safe direction to be wrong).

Do not reintroduce per-segment `text`/`position` columns or a fixed transcription "type" — both were deliberately removed in favor of this model.
