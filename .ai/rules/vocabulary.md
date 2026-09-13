---
paths:
  - '**'
---

# Vocabulary

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
