---
paths:
  - 'app/Support/Transcription/RegionSplitter.php,app/Http/Controllers/TranscriptionRegionController.php,resources/js/components/ManuscriptImageViewer.vue,resources/js/pages/Transcriptions/Editor.vue'
---

# Transcriptions

## Batch region splitting: character-count layout, not letter detection
Batch image-alignment (`TranscriptionRegionController::storeBatch`, `App\Support\Transcription\RegionSplitter::layout`) deliberately does NOT attempt character/word detection on the image — that was explicitly rejected as unreliable. Instead: draw one guide box over the selection's lines on the facsimile, and the server divides it geometrically from the text alone — vertically into one equal band per newline-separated line of the selection (blank lines take no band), horizontally by character position within each trimmed line: the first unit starts at the band's left edge, the last ends at its right, a word's width is proportional to its letter count, and whitespace between units keeps its share (a manuscript space is about a letter wide). This replaced the original equal-width, packed-cells, single-row division at the user's request — multi-line mapping and letter-count widths. It is still an approximation the scholar fine-tunes afterward, not geometric truth.

Granularities are `line`, `word`, `character` (plus the client-only `span`, one manual box). `RegionSplitter::isSplittable()` rejects any span containing Leiden markup (`[`, `]`, `{`, `}`, `_`) for word/character — a gap has no ink, so character-count widths would misplace every unit after it. `line` is exempt, deliberately: a whole line fills its band regardless, exactly like the manual single-box path, so gapped text can still be mapped line by line.

**General region editing**: `TranscriptionRegion` rows are now movable/resizable after creation (`PATCH transcription-regions/{region}`), not just create-once-delete-only. `ManuscriptImageViewer.vue` implements this with the standard image-editor convention — click a region to select it (`editableRegionId` prop), drag its body to move, drag one of 8 corner/edge handles to resize (anchoring the opposite edge/corner). This mechanism serves both manually-drawn and batch-split regions identically; there is no separate "adjust before commit" flow — the guide box commits immediately on draw, same as before, and all fine-tuning happens afterward through this one general capability.

Selection and background-deselection commit on pointer RELEASE within a ~5px slop (`pendingClick`), never on press — a press over an unselected box must bubble to the container and start a pan, because at high zoom boxes cover much of the leaf and select-on-press made panning nearly impossible (user-reported). Only the already-selected region claims its pointerdown (body drag = move).

Zoom is multiplicative (×1.2 / ÷1.2 — exact inverses, so steps retrace; user-tuned down from ×1.25, matching the old +0.2 feel at the shallow end), clamped to [1, 16] of the fitted size. The resize handles render INSIDE the zoomed transform and must counter-scale (`0.75 / scale` rem) to stay 12px on screen — unscaled, eight of them blanketed a small word box at high zoom, leaving no body to grab for moving (real bug).
