---
paths:
  - 'app/Support/Transcription/**,app/Http/Controllers/TranscriptionTextController.php,app/Http/Requests/UpdateTranscriptionTextRequest.php'
---

# Requests

## Transcription text is edited via an ops log, not a diff — SpanRebaser is retired
`App\Support\Transcription\SpanRebaser` (diff-based, LCP/LCS heuristic) is deleted. Text edits now flow through `PATCH transcriptions.text.update` (`TranscriptionTextController`) as an ordered log of exact `{start, end, text}` operations — see `App\Support\Transcription\SpanTransformer::transform()` (offsets) and `TextOpApplier::applyAll()` (the string itself, used only to independently recompute the authoritative text server-side and reject if it doesn't match what the client submitted — a concurrent-edit guard, not decorative).

## An assignment owns whole words when ASSIGNED, and keeps what is typed into it
`App\Support\Transcription\AssignmentBounds::wholeWords` snaps an editor's own
bounds out to whole words when she ASSIGNS or MOVES an assignment — half a word
is no assignment, the aligner reads words. That is the only place it runs.

There is deliberately NO trimming pass after a text edit. An earlier design
pulled whitespace back out of an assignment's edges on every save, to keep a
visible gap between assignments; the editor overruled it (user decision): a
space typed with the caret against an assignment's last word IS the assignment's,
and taking it back out read as the line having ended — and left the word
typed after it outside the line as well.

## Typing joins the assignment it TOUCHES, and touching means touching
`SpanTransformer::claimant` decides which assignment takes a pure insertion,
and it is the whole rule. An assignment claims when nothing at all stands
between the caret and its characters — inside it, at its first character, or
at its last — and WHATEVER is typed there is the assignment's, a space as much
as a letter. A caret with whitespace between it and every assignment claims
for none of them: that whitespace is the gap, and the gap is nobody's.

Order where several are touched at once: inside, then at the first
character, then at the last. So where two assignments meet flush the one
BEGINNING there takes it, and typing in front of a word belongs to that
word's assignment.

No assignment ever reaches ACROSS whitespace to claim something. A version
that did (to keep a line going after a typed space) is gone; removing the
trimming made it unnecessary, since the space itself now belongs to the
assignment and what follows touches it directly.

TYPING CANNOT LEAVE WORDS UNASSIGNED IN THE MIDST OF ASSIGNED TEXT (user
decision). Where the caret touches nothing but an assignment ends before it and
another begins after it, with only whitespace either way, the assignment
BEFORE carries on and reaches over the gap to take what was typed
(`enclosing`). A deliberate stretch of unassigned text is something an editor
asks for outright — a function of its own, still to be built — never
something typing produces by accident. Where one side has no assignment at all
the caret is not in the midst of assigned text, so typing after the last
assignment is unassigned as before, which is how new text gets transcribed.

Text that ARRIVES is the exception and stays unassigned: an op carrying
`imported` (the client sets it for a paste, a drop or an import) never
claims across a gap. Only typing is held to assigning what it lands among.

An assignment never BEGINS with whitespace. A space or a line break typed at
its first character is left above it and the assignment moves along onto its
own first word, carrying its marker with it — pressing Enter at the start of
an assigned line used to strand the marker on the line above (user report).
Whitespace typed at an assignment's END is the opposite case and IS claimed: it
holds the line open so the next word carries on.

`$takesTextAtStart` turns all of this on and ONLY ASSIGNMENTS get it. A
facsimile region is anchored to ink on parchment and a `LemmaReading` is a
quotation standing in an apparatus; neither grows because someone typed
against it, so both keep the plain rule and are pushed along instead. A
relocation paste is exempt throughout.
`$takesTextAtStart` turns this on and ONLY ASSIGNMENTS get it. A facsimile
region is anchored to ink on parchment and a `LemmaReading` is a quotation
standing in an apparatus; neither grows because someone typed in front of
it, so both keep the plain rule and are pushed along instead.

A relocation paste is exempt throughout: those words belong to the assignment
carried with them, never to a neighbour they land against.

The remembered-assigned-text column and its re-anchoring are GONE, with the
word-joining rule and the text threading that served them. They existed to
give back matter an assignment took in at its edge; the editor settled that
such matter is hers and should be kept, so there is nothing to give back.
Do not reintroduce a mechanism that revises an assignment after the fact:
every surprise in this editor came from one.

**Cut/paste relocation**: an op may carry a `cut_id` pairing one pure deletion (the cut) with one later pure insertion of exactly the deleted text (its paste). Spans wholly inside the cut are *carried* — they reappear at the paste, offsets shifted verbatim, unflagged; everything else sees an ordinary delete + insert. The claim is verified server-side in `TranscriptionTextController::normalizeOps` by replaying the log (a malformed claim loses its id and degrades to a plain edit); a cut whose paste never arrives in the same request degrades to a plain deletion (restorable by undo). This replaced the one-click `assignments.move` endpoint (`SpanTransformer::relocation` is deleted with it) — moving an assigned passage is now plain cut & paste in the editor. The old whole-line newline heuristic went with it, deliberately: the editor sees the selection and the result, and has undo.

**Partial relocation creates rows** (`RelocationAssignmentEffects`, applied only in `applySpans`' assignment branch): cutting PART of an assigned span and pasting it elsewhere is a sub-assignment transposition, not a trim — the fragment becomes a **new part** of its source passage at the paste site (`part` placed before/after the remainder by which side was cut), and the trimmed source is *unflagged* (nothing needs review once the fragment carries the assignment on). A paste landing strictly inside another assigned span must not absorb into it: the target **splits into two parts** of its own passage around the arrival. The offsets come from `SpanTransformer` prefix replays (the plan sees exactly what the real transform sees at cut/paste time), so keep `plan()` in step with any transform-rule change. The client now previews the SAME consequences instantly (`lib/relocationEffects.ts`, a mirror of `RelocationAssignmentEffects` — keep in step; synthetic preview rows carry negative ids and the server stays the authority at save time).

The concurrency guard (recomputed text mismatch) rejects on the **`ops` key**, distinct from `text`-keyed markup failures — the autosaving client stops retrying on `ops` (stale base, offer reload) but keeps retrying after a `text` failure (transiently unbalanced markup mid-typing).

`resources/js/lib/transcriptionEdit.ts` mirrors this logic for live client-side preview while typing (same dual-implementation pattern as `MarkupParser.php`/`transcriptionMarkup.ts`) — keep both in sync if the transform rules ever change.

`UpdateTranscriptionTextRequest.text` and `.ops.*.text` must stay `present, nullable` (never `required`/`string`-only) for the same `ConvertEmptyStringsToNull` reason `UpdateTranscriptionRequest.text` already documented — an empty string collapses to `null` before validation. `bootstrap/app.php` also excludes this route (`transcriptions/*/text`, matched via `$request->is()` — NOT `routeIs()`, since route naming isn't resolved yet when this global middleware runs) from the default `TrimStrings` middleware, since an edit op's text can legitimately be pure/leading/trailing whitespace (e.g. an op that's just `" "`).
