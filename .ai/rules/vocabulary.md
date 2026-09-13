---
paths:
  - '**'
---

# Vocabulary

## A SEGMENT is the smallest addressable range of a work
The unit a work's numbering scheme addresses — "Lysistrata 45", "Iliad
1.1" — is a SEGMENT (user decision: "passage is vague, it may mean any
type of textual passage; segment is much clearer, referring to the work's
canonical numbering scheme"). Everything a reader sees says segment.

The code still calls it `CanonicalPassage`, and an edition's row for one is
`EditionPassage`, with `canonical_passage_id` throughout the schema. So:

| the thing | user-visible | in code |
| --- | --- | --- |
| the work's addressable unit | segment | `CanonicalPassage` |
| an edition's inclusion of one | segment | `EditionPassage` |
| text assigned to one | assignment | `TranscriptionSegment` |

Note the trap in the third row: `TranscriptionSegment` is NOT a segment in
the user's sense — it is an ASSIGNMENT of text to one. Read a bug report
saying "segment" as the work's unit, not as that model.

Renaming the models and the schema to match was left undone deliberately,
not forgotten: it is two model renames, a table and a column rename across
the schema, and some 5,500 textual occurrences, all against live data. Do
it as its own piece of work, or not at all.

## An ASSIGNMENT, never a citation
What links a stretch of a transcript's text to a passage of a work is an
ASSIGNMENT: the text is ASSIGNED to the passage, text with none is
UNASSIGNED, and the chip that announces one in the editor is its MARKER.
The word "citation" was used for this throughout and is gone from the app
(user decision — "citation is not clear to me"). `TranscriptionSegment` is
still the model's name; the thing it records is an assignment.

The verb takes text as its object and the passage as its target: a layer
ASSIGNS TEXT TO a passage. Writing "assigns the passage" inverts it and
reads as though the passage were being handed out.

Three other senses keep their own words, because "assignment" is not what
they mean:

- **Bibliography citations** — what an edition or a conjecture cites from
  the literature (`BibliographyReference`, `Citation` in types/edition.ts,
  `EditionController::citations`, biblatex's `\cite[pre][post]`). Still
  citations, in the ordinary scholarly sense.
- **The NUMBERING order** — the order a work's own reference scheme gives
  its passages, against which an apparatus reports transpositions. The
  ordering candidate's `source` is `'numbering'` and the page calls it
  "Numbering order".
- **Passage labels and the numbering scheme** — "1.5" is a passage label,
  and `ReferenceScheme` defines how passages are NUMBERED. Not assigned.

When renaming in this direction again, watch for all three: a blind swap
turned biblatex's `\cite[pre][post]` into `\assign[pre][post]`, and a
conjecture's bibliography-citation count into an "assignment" count on a
deletion warning.
