---
paths:
  - 'app/Support/Transcription/**,app/Http/Controllers/TranscriptionTextController.php,app/Http/Requests/UpdateTranscriptionTextRequest.php'
---

# Requests

## Transcription text is edited via an ops log, not a diff — SpanRebaser is retired
`App\Support\Transcription\SpanRebaser` (diff-based, LCP/LCS heuristic) is deleted. Text edits now flow through `PATCH transcriptions.text.update` (`TranscriptionTextController`) as an ordered log of exact `{start, end, text}` operations — see `App\Support\Transcription\SpanTransformer::transform()` (offsets) and `TextOpApplier::applyAll()` (the string itself, used only to independently recompute the authoritative text server-side and reject if it doesn't match what the client submitted — a concurrent-edit guard, not decorative).

## A citation owns whole words when CITED, and keeps what is typed into it
`App\Support\Transcription\CitationBounds::wholeWords` snaps an editor's own
bounds out to whole words when she CITES or MOVES a citation — half a word
is no citation, the aligner reads words. That is the only place it runs.

There is deliberately NO trimming pass after a text edit. An earlier design
pulled whitespace back out of a citation's edges on every save, to keep a
visible gap between citations; the editor overruled it (user decision): a
space typed with the caret against a citation's last word IS the citation's,
and taking it back out read as the line having ended — and left the word
typed after it outside the line as well.

## Typing joins the citation it TOUCHES, and touching means touching
`SpanTransformer::claimant` decides which citation takes a pure insertion,
and it is the whole rule. A citation claims when nothing at all stands
between the caret and its characters — inside it, at its first character, or
at its last — and WHATEVER is typed there is the citation's, a space as much
as a letter. A caret with whitespace between it and every citation claims
for none of them: that whitespace is the gap, and the gap is nobody's.

Order where several are touched at once: inside, then at the first
character, then at the last. So where two citations meet flush the one
BEGINNING there takes it, and typing in front of a word belongs to that
word's citation.

No citation ever reaches ACROSS whitespace to claim something. A version
that did (to keep a line going after a typed space) is gone; removing the
trimming made it unnecessary, since the space itself now belongs to the
citation and what follows touches it directly.

`$takesTextAtStart` turns all of this on and ONLY CITATIONS get it. A
facsimile region is anchored to ink on parchment and a `LemmaReading` is a
quotation standing in an apparatus; neither grows because someone typed
against it, so both keep the plain rule and are pushed along instead. A
relocation paste is exempt throughout.
`$takesTextAtStart` turns this on and ONLY CITATIONS get it. A facsimile
region is anchored to ink on parchment and a `LemmaReading` is a quotation
standing in an apparatus; neither grows because someone typed in front of
it, so both keep the plain rule and are pushed along instead.

A relocation paste is exempt throughout: those words belong to the citation
carried with them, never to a neighbour they land against.

The remembered-cited-text column and its re-anchoring are GONE, with the
word-joining rule and the text threading that served them. They existed to
give back matter a citation took in at its edge; the editor settled that
such matter is hers and should be kept, so there is nothing to give back.
Do not reintroduce a mechanism that revises an assignment after the fact:
every surprise in this editor came from one.

**Cut/paste relocation**: an op may carry a `cut_id` pairing one pure deletion (the cut) with one later pure insertion of exactly the deleted text (its paste). Spans wholly inside the cut are *carried* — they reappear at the paste, offsets shifted verbatim, unflagged; everything else sees an ordinary delete + insert. The claim is verified server-side in `TranscriptionTextController::normalizeOps` by replaying the log (a malformed claim loses its id and degrades to a plain edit); a cut whose paste never arrives in the same request degrades to a plain deletion (restorable by undo). This replaced the one-click `transcription-segments.move` endpoint (`SpanTransformer::relocation` is deleted with it) — moving a cited passage is now plain cut & paste in the editor. The old whole-line newline heuristic went with it, deliberately: the editor sees the selection and the result, and has undo.

**Partial relocation creates rows** (`RelocationSegmentEffects`, applied only in `applySpans`' segment branch): cutting PART of a cited span and pasting it elsewhere is a sub-segment transposition, not a trim — the fragment becomes a **new part** of its source passage at the paste site (`part` placed before/after the remainder by which side was cut), and the trimmed source is *unflagged* (nothing needs review once the fragment carries the citation on). A paste landing strictly inside another cited span must not absorb into it: the target **splits into two parts** of its own passage around the arrival. The offsets come from `SpanTransformer` prefix replays (the plan sees exactly what the real transform sees at cut/paste time), so keep `plan()` in step with any transform-rule change. The client now previews the SAME consequences instantly (`lib/relocationEffects.ts`, a mirror of `RelocationSegmentEffects` — keep in step; synthetic preview rows carry negative ids and the server stays the authority at save time).

The concurrency guard (recomputed text mismatch) rejects on the **`ops` key**, distinct from `text`-keyed markup failures — the autosaving client stops retrying on `ops` (stale base, offer reload) but keeps retrying after a `text` failure (transiently unbalanced markup mid-typing).

`resources/js/lib/transcriptionEdit.ts` mirrors this logic for live client-side preview while typing (same dual-implementation pattern as `MarkupParser.php`/`transcriptionMarkup.ts`) — keep both in sync if the transform rules ever change.

`UpdateTranscriptionTextRequest.text` and `.ops.*.text` must stay `present, nullable` (never `required`/`string`-only) for the same `ConvertEmptyStringsToNull` reason `UpdateTranscriptionRequest.text` already documented — an empty string collapses to `null` before validation. `bootstrap/app.php` also excludes this route (`transcriptions/*/text`, matched via `$request->is()` — NOT `routeIs()`, since route naming isn't resolved yet when this global middleware runs) from the default `TrimStrings` middleware, since an edit op's text can legitimately be pure/leading/trailing whitespace (e.g. an op that's just `" "`).
