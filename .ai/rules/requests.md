---
paths:
  - 'app/Support/Transcription/**,app/Http/Controllers/TranscriptionTextController.php,app/Http/Requests/UpdateTranscriptionTextRequest.php'
---

# Requests

## Transcription text is edited via an ops log, not a diff — SpanRebaser is retired
`App\Support\Transcription\SpanRebaser` (diff-based, LCP/LCS heuristic) is deleted. Text edits now flow through `PATCH transcriptions.text.update` (`TranscriptionTextController`) as an ordered log of exact `{start, end, text}` operations — see `App\Support\Transcription\SpanTransformer::transform()` (offsets) and `TextOpApplier::applyAll()` (the string itself, used only to independently recompute the authoritative text server-side and reject if it doesn't match what the client submitted — a concurrent-edit guard, not decorative).

`SpanTransformer`'s case order matters and encodes a deliberate boundary-gravity rule for zero-width insertions: exactly at a span's `start` shifts the span forward (doesn't join it); exactly at a span's `end` extends it (continuing to type after existing content absorbs into it). A non-zero-width edit that fully consumes a span with a non-empty replacement follows the replacement and flags `needs_review`; one that empties it entirely (nothing to replace it with) deletes the row outright — confirmed product decision, not a technical default. `TranscriptionRegion.text` (denormalized) is now actively resynced from the new substring on every save through this endpoint, unlike before.

`resources/js/lib/transcriptionEdit.ts` mirrors this logic for live client-side preview while typing (same dual-implementation pattern as `MarkupParser.php`/`transcriptionMarkup.ts`) — keep both in sync if the transform rules ever change.

`UpdateTranscriptionTextRequest.text` and `.ops.*.text` must stay `present, nullable` (never `required`/`string`-only) for the same `ConvertEmptyStringsToNull` reason `UpdateTranscriptionRequest.text` already documented — an empty string collapses to `null` before validation. `bootstrap/app.php` also excludes this route (`transcriptions/*/text`, matched via `$request->is()` — NOT `routeIs()`, since route naming isn't resolved yet when this global middleware runs) from the default `TrimStrings` middleware, since an edit op's text can legitimately be pure/leading/trailing whitespace (e.g. an op that's just `" "`).
