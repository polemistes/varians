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
- `needs_review` on a READING has exactly one meaning (user decision,
  narrowing an earlier broad flag): an edition's SELECTED choice whose
  manuscript backing changed — confirm or re-choose. An UNSELECTED reading
  the edit destroyed or left with guessed boundaries is never flagged: it
  is deleted and its passage re-derived (`realignDamaged`, calling
  `PassageAligner::realignLayer` AFTER the new text is saved, since
  collation reads it; refused where pinned readings hold the passage, in
  which case the deleted candidate simply returns at the next
  materialization). A reading flagged before the edit is not re-judged. A
  destroyed SELECTED reading is kept zero-width and flagged, because
  `edition_lemmas.selected_reading_id` is NOT NULL and cascades — deleting
  would discard that edition's decision rather than merely emptying it.
  The flag has a full lifecycle now: re-picking the flagged candidate in
  the variant panel confirms it and CLEARS the flag
  (`EditionVariantController::store`), picking another candidate
  re-chooses and DROPS a zero-width flagged row nothing selects any more.
  Segment/region flags keep their own rule: set on partial clobber,
  cleared by manual re-selection/redraw. A destroyed *segment* is **deleted** too (user
  decision, REVERSING the earlier tombstone policy: a citation without text
  is nothing, and the zero-width flagged markers read as clutter and never
  actually restored anything). What protects the editor instead: cut/paste
  pairs carry spans whole, and UNDO restores the rows with the text — the client's `EditHistory` snapshots the segments
  AND image-mapping regions a destructive op deleted (pre-op coordinates,
  exactly what the undo restores) and posts them to
  `transcription-spans.restore` after the undone text saves; rows whose
  words already carry the same assignment or an overlapping mapping (a
  lone cut's undo completed the relocation first) are skipped, a region
  whose image belongs to another witness is never restored, the region
  excerpt is recomputed server-side, and `SiblingSync::heal` gives
  restored spans their counterparts. Nothing asks for confirmation any
  more — the former wipe checkbox and its server gate
  (`guardAgainstUnconfirmedWipe`, `confirm_wipe`) were removed (user
  decision: undo covers blanking too). Do not reintroduce tombstones;
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
`TranscriptionSegment.part`), the passage's collation for the layer may be
stale, and `recollateLostParts` resolves it AFTER the new text saves, by the
same narrowing as damaged readings: re-derive (`realignLayer`) where a
collation exists, flag the surviving parts only where re-derivation is
refused (pinned readings — the late-part rule), and do NOTHING where the
layer was never collated on the passage. Blind-flagging the survivors was
the old rule and read as noise (real incident: a rearranged, never-collated
line arrived flagged in both layers).

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
character of a spelling change is indistinguishable from one — EXCEPT a
line-break edit (whitespace-only, a newline on either side of the
change), which normalizeOps marks atomic server-side even for a single
keystroke: Enter is never the start of a spelling change, and the line
structure is the SHARED part of the skeleton (page breaks live in it).
Relocation pairs stay all-or-nothing (an unmappable half aborts the whole
mirror); an unmirrorable plain op is merely skipped. The in-step check is
STRUCTURAL (word shapes + whitespace verbatim), so layers whose lines
drifted to hold DIFFERENT words in the same shape still pass it — and an
index-mapped relocation then moves the wrong words (real incident: a
mirrored paste landed mid-line, splitting a citation). `foldMatches`
therefore verifies the words CORRESPOND before a cut or an atomic
deletion/replacement mirrors: per word, folded equality or a shared folded
prefix/suffix of ≥2 chars (letter-variant counterparts like
γιγνεται/γίνεται and alpha/alfa must pass). Mismatch refuses the mirror —
honest refusal over silent mislanding — and the refusal notice names the
first structurally-diverging line, or says the words no longer correspond
when the structure still matches. A line-break
insertion INSIDE a word still mirrors (`LayerMirror::wordSplitOffset`):
pasting a line flush against another glues two words into one in BOTH
layers, and the Enter separating them lands mid-word where no plain
offset maps (real bug — the sibling stayed glued and the layers parted).
The sibling's split point is wherever its word's orthography-folded
suffix (or, failing that, prefix — either half pinning the one junction
suffices, since γιγνεται/γίνεται-type letter differences break one side's
fold) matches ours; fold-equal candidates can only differ by fold-empty
material (folding is concatenative), and the RIGHTMOST wins because
punctuation binds to the line it ends (Γενετυλλίδος, | νῦν). Page breaks are
deliberately NOT reapplied on the sibling — they live on the transcription
in shared line coordinates and the editing layer's pass already moved them;
a second pass would move them twice (test-pinned).

## WordSpans is the projection layer for transcript-level coordinates
`App\Support\Transcription\WordSpans` (mirrored in
`resources/js/lib/wordSpans.ts`; `WordSpansTest` is the contract) converts
character offsets ⇄ word coordinates: word RANGES snap outward to whole
words (citations are word-granular, user decision); sub-word ANCHORS
`{word, char}` serve facsimile mappings, read against each layer's own
spelling and clamped to its length. This is the coordinate system segments
and regions migrate to (spans stored ONCE per transcript, projected per
layer) and the join the edition-facsimile highlight will use — a reading's
char range in the normalized layer and a mapping drawn on the diplomatic
layer meet in word indices.

## Assignments and mappings are DONE ONCE — counterpart rows linked by group_id
A span is ONE identity seen from two layers: counterpart rows share a
`group_id` (segments and regions both). `SiblingSync` creates the pair on
assignment/mapping (projected through WordSpans: word ranges for
citations, sub-word anchors for mappings), every mutation reaches the
other half by the LINK (`counterpartSegment`/`counterpartRegion` — never
by range-matching, which broke the moment the layers drifted), and
`SiblingSync::heal()` runs after every text save: when the layers are in
step, one-sided spans get their counterpart (an existing unlinked twin is
linked; otherwise it is created by projection) — so a span assigned while
the layers were apart self-repairs on the catch-up edit.

Rows deliberately stay per-layer with per-layer character offsets, each
transforming with its OWN layer's edits. The once-planned single
word-coordinate store was found UNSOUND and abandoned: while the layers
are out of step, a catch-up edit cannot be told from a leading one, so a
shared coordinate would double-move spans on resync. Do not revive it.
The word-coordinate machinery (WordSpans) remains the projection engine
for creation, healing, and the edition-facsimile join.

## Undo reverses each op AS IT WAS — atomic inherited, sibling spelling carried
An inverse op inherits its original's `atomic` flag (`invertOp` in
`lib/editHistory.ts`); `applyHistoryStep` no longer stamps every undo
atomic. Stamping did mirror the inverse of edits that never mirrored — a
two-letter deletion at a word's head, undone, glued ΜΗ onto the sibling's
μῆνιν (real bug, reproduced in the browser). Two further rules follow:

- A typing op is atomic only when it DELETES a range (`text === ''`,
  range > 1). Typing OVER a selection is how a word is retyped, and marking
  it atomic mirrored its first letter and wiped the sibling's word (real
  bug: ἄειδε typed over → ΑΕΙΔΕ became α).
- Where an atomic op removes words, the client snapshots the sibling's own
  words for that stretch (`siblingTextRemovedBy`, mapped through
  `wordSpans.mapOffset` on the `correspondence.text` prop, only while the
  layers are in step and no unsaved atomic/cut op could have changed the
  sibling) and the inverse carries them as `ops.*.mirror_text`.
  `LayerMirror` inserts `mirror_text ?? text` on the sibling, so undoing a
  mirrored deletion restores γίνεται there, not our ΓΙΓΝΕΤΑΙ. Absent, the
  verbatim replay stands.

Undo also restores span BOUNDS, not only deleted rows: `SpanTransformer`
gives a span's start right-gravity, so the undo of a deletion at a span's
head pushes the span past the restored words (real bug: "the fox" cited,
delete "fo", undo, citation covered "x"). The history snapshots every live
span before a step (`SpanSnapshots`, by row id); after the undo saves, rows
whose saved bounds differ are posted as `adjust_segments`/`adjust_regions`
to `transcription-spans.restore`, which updates them and lets the in-step
counterpart follow (`SiblingSync::followSegment`/`followRegion`).

## One transcript per witness per work (user decision, 2026-09-09)
Once a witness's text of a work is cited in one of its transcripts, every
citation of that work in that witness belongs to the same transcript
(`App\Support\Transcription\WorkOwnership::guard`, called when a span is
marked, re-cited, or copied across transcripts of the same witness). A
witness may still hold several transcripts for different works, or one
for all its works; a work carried in two separate places fits one
transcript, page breaks saying where each stretch sits. Existing data is
never changed silently: `php artisan witnesses:check-work-ownership` lists
what breaks the rule (`WorkOwnership::violations`) and the editor moves
the citations. The edition page's witness pulldown relies on this (one
witness, one transcript of the work), while still rendering several
stacked if older data has them.

## Citation spans are held to their words after every save (user decision)
`CitationIntegrity::snap` runs after every save that can move a span —
text update (both layers), undo restore, span copy, marking/re-citing a
span — and sets or clears `transcription_segments.boundary_review`: a
span that begins or ends INSIDE a word (unless another citation meets it
exactly there — two lines pasted flush together — or the neighbour is
inside another citation) or overlaps another is flagged; when its bounds
are right again the flag clears by itself. Offsets are never touched.
Whitespace at a span's edges is NOT drift: a drag over a line takes its
line break along, and the relocation tests cite "quick " deliberately.
The badge shows the flag like `needs_review` (red, dashed) with its own
explanation; `needs_review` stays the editor's own confirmation flag.
A text save that leaves a span drifted logs the ops (`Log::warning`,
"Citation spans drifted off their words") so the cause can be found —
one witness's spans slid a character, then a word, from a sequence of
edits that was never recorded; the transform, mirror and undo paths all
check out in isolation. `php artisan transcriptions:check-citations`
lists drift across all layers; `--snap` re-evaluates the flags. The
report and the snap share `CitationIntegrity::assess`.
