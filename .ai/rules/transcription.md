---
paths:
  - app/Http/Controllers/TranscriptionTextController.php
  - app/Models/LemmaReading.php
  - 'app/Support/Transcription/**'
---

# Transcription

## Three sets of offsets index into transcription.text, not two
`TranscriptionSegment`, `TranscriptionRegion` **and** a witness-sourced
`LemmaReading` all carry character offsets into the same `Transcription.text`.
All three must go through `SpanTransformer` in
`TranscriptionTextController::update`.

Missing the third was a real bug: editing "the quick fox" into "the slow fox"
left the apparatus reading "the" / "slow " / "ox", and it failed silently
because `mb_substr` past the end returns `""`. It also fed
`PassageAligner::representativeText`, so one stale reading corrupted the
consensus every later witness was diffed against.

Filter to `whereNotNull('start_offset')` first — conjecture-sourced readings
have null offsets, and `(int) null` becomes a 0..0 span that any leading edit
will mangle.

## A text edit acts and reports; it never asks
An edit to a witness only reaches a reader when that witness is the reading
some edition prints. Where the edition prints a different manuscript, or a
conjecture, the apparatus simply reports the witness's new wording and the
printed text is untouched — there is nothing to decide. Do not reintroduce a
prompt here; an earlier version refused any save that destroyed a reading
*without checking whether an edition selected it*, so deleting a word from a
witness nobody printed raised a modal about nothing.

What `applyReadings` does instead:

- offsets always transform;
- a partial clobber sets `needs_review`;
- a destroyed *reading* is **deleted** when nothing selects it (the
  manuscript no longer has those words, and a reading is machine-re-derivable
  by re-collation) and **kept zero-width and flagged** when an edition does
  select it, because `edition_lemmas.selected_reading_id` is NOT NULL and
  cascades — deleting would discard that edition's decision rather than
  merely emptying it. A destroyed *segment* is different: always tombstoned
  (zero-width + flagged, in `applySpans`), never deleted — citation
  assignment is human work autosave must not destroy via a transient state,
  and unlike a reading it cannot be re-derived. The tombstone renders as a
  badge-only marker in `AlignableText` for the editor to re-anchor or remove;
- a cut/paste op pair (shared `cut_id`) relocates instead of destroying:
  spans wholly inside the cut travel to the paste, unflagged; a *partial*
  cut of a span spawns a new part of the source passage at the paste site,
  and a paste inside another span splits it into two parts of its own
  passage (`RelocationSegmentEffects`) — see `.ai/rules/requests.md`;
- afterwards `update()` flashes the one consequence the editor cannot see from
  that page: that her correction also changed an edition's own printed
  wording. Keyed off the reading's *text*, so an edit elsewhere that merely
  shifts offsets stays silent.

Segments are disposable on destruction — with one addition: when a destroyed
segment was one *part* of a passage cited by several spans in the layer (see
`TranscriptionSegment.part`), `applySpans` flags the surviving sibling parts
`needs_review`, since the passage's witness text just lost a piece and the
layer's collation of it is now stale.

`HandleInertiaRequests` shares a general `flash.message` for this. It is the
app's only flash channel; keep it generic.

## Greek regularization removes, never supplies
`App\Support\Transcription\GreekText` strips accents, breathings, all
diacritics, or punctuation — decidable without knowing the language, by
decomposing and dropping named combining marks. Mirrored in
`resources/js/lib/greekText.ts`, which the editor uses to build the same edit
locally; keep the two in step.

Deliberately absent is the opposite direction. *Adding* correct accents and
breathings to text that lacks them needs morphological analysis against a
lexicon and stays ambiguous even then (τίς/τις, ἦ/ἥ); a tool that got it
silently wrong would be worse than none, since its errors would read as
scribal variants. Do not add one.

The Leiden markup delimiters `[ ] { } _` are never touched, and punctuation is
a listed set rather than a Unicode class so that widening the definition
cannot catch them.

`stripOps()` returns the change as ordinary edit operations, in descending
order so each one's offsets are still valid when applied. Never replace the
text wholesale: every citation span, image region and collated reading is
recorded as offsets into it, and one op covering the document reads as
"everything was replaced", flagging or destroying all of them. Character-level
ops fall strictly inside any span covering them, which merely shifts that
span's end — verified: stripping accents left a citation span covering the
same words, unflagged.

`GreekText::foldOrthography` (diacritics + punctuation + case) is what
`EditionController` uses to mark an apparatus candidate `orthographic_only`:
the same word spelled differently, rather than a different word. Reported, not
suppressed — whether an orthographic difference is worth printing is the
editor's call, and she can say so in an EditionComment.

## Tokenization is a per-work strategy
`App\Support\Transcription\Tokenizer` divides text into the tokens collation
aligns on, chosen by `Work.tokenization`. Whitespace is the only implementation
so far. The seam exists because collation needs a *token sequence* and
whitespace is one way to get one — scripts that do not mark word boundaries
orthographically (Devanagari for Sanskrit) will need another, and an editor
there would not want spaces inserted into the normalized text to satisfy the
collator. Add a second `Tokenization` case only together with its
implementation.

## Pages are their own thing; the division is one line number per transcription
A `ManuscriptPage` exists whether or not anyone has photographed it —
transcriptions are often made from a facsimile, a microfilm, or the manuscript
itself, and the text still has to be divided onto pages. A `ManuscriptImage` is
a photograph *of* a page and takes its label from there; before this, a page
*was* an image and `path` is NOT NULL, so an unphotographed page could not be
recorded at all.

`TranscriptionPageBreak` says where a page begins in a **transcription**, as a
**line number** — one division for both layers, not one each. A page holds a
stretch of the manuscript and both layers transcribe that same stretch, so
where it begins is a fact about the transcription; held per layer, the two were
free to drift apart with nothing to say which was right.

The coordinate is the line because it is the safest one the layers share.
Word correspondence is now the documented invariant (see the word-skeleton
section below — crasis resolution is an emendation, not normalization, per
user decision), but a layer mid-edit can be transiently out of step, and a
line number stays valid through every such state.
`DiplomaticCounterpart` refuses to map when token counts differ, and a
test pins that (ΚΑΓΩ ΕΙΠΟΝ → καὶ ἐγώ εἶπον). Lines survive all of it, because a
line of the transcription is a line of the manuscript in either layer, and a
page begins at a line start since a manuscript line does not span two pages.
Each layer resolves the line to its own offsets with
`TranscriptionLayer::offsetOfLine()`.

A single number, not a range: the page runs to wherever the next one begins, so
pages cannot overlap or leave gaps. Lines before the first break are on no page
yet.

Editing text still has to maintain the division, but only when whole lines come
or go — changing characters within a line moves nothing.
`TranscriptionTextController::applyPageBreaks` resolves each break to the edited
layer's offset, moves it with the same machinery as everything else, and reads
the line back, rather than reasoning about newlines directly.

Breaks move by `SpanTransformer::transformPoints`, **not** `transform()`. A
point is not a zero-width span: `transform()` gives a span's start
right-gravity, so typing exactly at a zero-width span pushes it forward, and a
break treated that way would put the first words typed at the top of a page
onto the page before — the case an editor transcribing page by page hits every
time she starts a page. `transformPoints` keeps an insertion at the break
*after* it. A break is never deleted: deleting a page's text empties the page
rather than abolishing it, leaving the break where the deletion began, possibly
alongside the next one. That is why nothing enforces distinct offsets — two
breaks at the same place is an empty page.

## The two layers share a word skeleton; only characters within words differ
Normalization operates INSIDE words — orthography, accents, breathings,
punctuation attached to a word. It never reorders, adds or removes words:
splitting crasis is an emendation for the conjecture system, not
normalization (user decision — no flag-tolerated divergence category
exists). So when both layers have text they must carry the same words in
the same lines; character offsets stay per-layer (γίγνομαι/γίνομαι differ
in length). `LayerCorrespondence` measures this: `divergence()` (per-line
word counts, first mismatch) feeds the witness page's in-step indicator via
the `layerCorrespondence` prop (in the autosave partial-reload `only`
list), and `pattern()` (words collapsed to `w`, whitespace verbatim) is the
strict precondition for mirroring.

**Word-respecting edits mirror across layers** (`LayerMirror`, called from
`TranscriptionTextController::mirrorRelocations`): a cut/paste pair moving
whole words is replayed on the sibling using its own spellings; an ATOMIC
plain op (client-flagged `atomic` — paste, import, undo/redo, and
selection-wide deletions; NEVER keystrokes, and deliberately never strip,
which is a spelling-class edit) whose endpoints sit on word boundaries is
replayed VERBATIM — same words in both layers, spellings adjusted later
(user decision). A keystroke must stay in its layer because the first
character of a spelling change is indistinguishable from one. Relocation
pairs stay all-or-nothing (an unmappable half aborts the whole mirror);
an unmirrorable plain op is merely skipped. Page breaks are
deliberately NOT reapplied on the sibling — they live on the transcription
in shared line coordinates and the editing layer's pass already moved them;
a second pass would move them twice (test-pinned).
