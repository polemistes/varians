---
paths:
  - '**'
---

# Vocabulary

## A SEGMENT is the smallest addressable range of a work
The unit a work's numbering scheme addresses — "Lysistrata 45", "Iliad
1.1" — is a SEGMENT (user decision: "passage is vague, it may mean any
type of textual passage; segment is much clearer, referring to the work's
canonical numbering scheme"). Everything a reader sees says segment, and so
does the code: the model is `Segment` (table `segments`, column
`segment_id` everywhere something points at one), an edition's row for one
is `EditionSegment` (`edition_segments`), and the support classes are
`SegmentAdder`, `SegmentAligner`, `SegmentOrderRewriter`, `SegmentResolver`.
Both were `…Passage` until 2026-09-13 (migration 2026_09_13_130000 renamed
the tables, the columns and every index over them); the word "passage" is
now gone from the application, code and prose alike.

## An ASSIGNMENT, never a citation — and never a segment
What links a stretch of a transcript's text to a segment of a work is an
ASSIGNMENT: the text is ASSIGNED to the segment, text with none is
UNASSIGNED, and the chip that announces one in the editor is its MARKER.
The model is `Assignment` (table `assignments`, migration
2026_09_13_120000; it was `TranscriptionSegment`), its routes are
`assignments.*`, and changing which segment one points at is
`AssignmentController::reassign`. The word "citation" was used for this
throughout and is gone from the app (user decision — "citation is not clear
to me").

The verb takes text as its object and the segment as its target: a layer
ASSIGNS TEXT TO a segment. Writing "assigns the segment" inverts it and
reads as though the segment were being handed out.

| the thing | user-visible | in code |
| --- | --- | --- |
| the work's addressable unit | segment | `Segment` |
| an edition's inclusion of one | segment | `EditionSegment` |
| text assigned to one | assignment | `Assignment` |

The renames were done assignment FIRST, then segment, and that order
mattered: had "segment" been introduced for the work's unit while the
assignment model still carried the word, it would have meant two things in
the code at once. A `git log` reader meeting `TranscriptionSegment` or
`CanonicalPassage` in an old commit is reading the same two things under
their old names.

Three other senses keep their own words, because "assignment" is not what
they mean:

- **Bibliography citations** — what an edition or a conjecture cites from
  the literature (`BibliographyReference`, `Citation` in types/edition.ts,
  `EditionController::citations`, biblatex's `\cite[pre][post]`). Still
  citations, in the ordinary scholarly sense.
- **The NUMBERING order** — the order a work's own reference scheme gives
  its segments, against which an apparatus reports transpositions. The
  ordering candidate's `source` is `'numbering'` and the page calls it
  "Numbering order".
- **Segment labels and the numbering scheme** — "1.5" is a segment label,
  and `ReferenceScheme` defines how segments are NUMBERED. Not assigned.

When renaming in this direction again, watch for all three: a blind swap
turned biblatex's `\cite[pre][post]` into `\assign[pre][post]`, and a
conjecture's bibliography-citation count into an "assignment" count on a
deletion warning.
