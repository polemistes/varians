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
- a destroyed span is **deleted** when nothing selects it (the manuscript no
  longer has those words, so dropping the candidate is truthful) and **kept
  zero-width and flagged** when an edition does select it, because
  `edition_lemmas.selected_reading_id` is NOT NULL and cascades — deleting
  would discard that edition's decision rather than merely emptying it;
- afterwards `update()` flashes the one consequence the editor cannot see from
  that page: that her correction also changed an edition's own printed
  wording. Keyed off the reading's *text*, so an edit elsewhere that merely
  shifts offsets stays silent.

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
