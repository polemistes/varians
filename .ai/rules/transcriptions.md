---
paths:
  - 'app/Support/Transcription/RegionSplitter.php,app/Http/Controllers/TranscriptionRegionController.php,resources/js/components/ManuscriptImageViewer.vue,resources/js/pages/Transcriptions/Editor.vue'
---

# Transcriptions

## Batch region splitting: uniform division, not letter detection
Batch image-alignment (`TranscriptionRegionController::storeBatch`, `App\Support\Transcription\RegionSplitter`) deliberately does NOT attempt character/word detection on the image — that was explicitly rejected as unreliable. Instead: draw one guide box over a line/phrase, and the server divides that box's width into N *equal-width* cells (one per non-whitespace character or word in the selected text), packed tightly left-to-right with no reserved space for whitespace. This is a uniform-spacing approximation the scholar is expected to fine-tune afterward — it is not meant to be geometrically accurate on its own.

`RegionSplitter::isSplittable()` rejects any span containing Leiden markup (`[`, `]`, `{`, `}`, `_`) — batch-split is plain-text-only by design; markup-carrying spans fall back to manual single-box alignment (`TranscriptionRegionController::store`, unaffected/unrestricted).

**General region editing**: `TranscriptionRegion` rows are now movable/resizable after creation (`PATCH transcription-regions/{region}`), not just create-once-delete-only. `ManuscriptImageViewer.vue` implements this with the standard image-editor convention — click a region to select it (`editableRegionId` prop), drag its body to move, drag one of 8 corner/edge handles to resize (anchoring the opposite edge/corner). This mechanism serves both manually-drawn and batch-split regions identically; there is no separate "adjust before commit" flow — the guide box commits immediately on draw, same as before, and all fine-tuning happens afterward through this one general capability.
