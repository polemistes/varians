# The archive and its formats

Varians writes everything it holds about a work into a directory of open files, kept as a git repository, so that the work can be read and rebuilt without Varians (PLAN.md 4.12). This document is the specification of that directory. A copy of it travels in every archive as `README.md`.

## Layout

```
<work-slug>/
  README.md                      this document
  work.json                      the work: title, author, language, identifier, scheme, normalization profile
  segments.tsv                   id, label, sort key, address (JSON) of every segment, in the work's order
  conjectures.json               every conjecture record of the work
  reported-readings.json         readings reported for witnesses that are not transcribed
  bibliography.bib               every bibliography item cited by anything in the work (biblatex)
  bibliography.json              the same items with their ids
  citations.json                 which conjecture, reading, edition or note cites which item, with pre- and postnotes
  witnesses/<witness-slug>/
    witness.json                 the witness: siglum, name, category, format, repository, shelfmark, description fields
    pages.json                   pages in order, with image sources (archive file, storage path or IIIF URL) and sizes
    images/<label>-<id>.<ext>    uploaded originals (IIIF images are referenced, not copied)
    transcriptions/<name-slug>/
      transcription.json         the stream: every item with its id, forms, marks, segment starts
      transcription.txt          the normalized text as plain text, for a quick look
      transcription.tei.xml      the same as TEI (lb, pb, cb, features as elements, msDesc, facsimile zones)
      zones.json                 image zones: token ids, page, geometry in fractions of the image
      memory.json                the normalization memory (confirmed written-to-read pairs)
      reviews.json               each person's review position (server archive only; absent when there is none)
      history.ndjson             one changeset per line: version, user, time, operations, reverse operations
      moments.json               named and published moments of the history, with a publication's basis
  editions/<edition-slug>/
    edition.json                 metadata, conventions, the conspectus, adoptions, collaborators, notes, site kinds, and the stream with sources
    alignment.json               the editors' constraints on the alignment: edition tokens held to witness tokens
    reviews.json                 the sites the editors have looked at, and each person's review position
    edition.tei.xml              TEI critical apparatus, parallel segmentation
    edition.txt                  the text with the apparatus under each segment, plain text
    edition.md                   the same as Markdown
    history.ndjson, moments.json as for transcriptions
  schemas/                       JSON Schema for every .json file above, versioned
```

## What the archive holds

Every table of the database is archived, derived from archived data, or transient (the list is `apps/web/src/lib/server/archive/coverage.ts`, and a test keeps it complete). Every archived row is in these files, with its id and creation time, so that an import gives back the same rows; the derived tables (the segment index, collation results, checkpoints, the record of archive commits) are rebuilt. Accounts are not archived: records name the accounts that own and maintain them by id and name. The files are rewritten within a minute of a change; git commits mark named moments, publications and the nightly pass.

## Identifiers

Every record carries the id it has in Varians (a ULID, 26 characters). Ids are the links between files: a zone names token ids, an edition token names the witness tokens it was taken from, a changeset names the items it touched. Slugs in paths are for people; ids are for programs.

## The stream (`transcription.json`, the `content` of `edition.json`)

```json
{ "items": [
  { "kind": "break", "id": "...", "type": "page", "pageId": "..." },
  { "kind": "token", "id": "...", "form": "ΜΗΝΙΝ", "norm": "μῆνιν", "segment": { "segmentId": "...", "part": 1 } },
  { "kind": "token", "id": "...", "form": "ΑΕΙΔΕ", "marks": [ { "kind": "unclear", "from": 0, "to": 2 } ] },
  { "kind": "break", "id": "...", "type": "line" },
  { "kind": "object", "id": "...", "type": "gap", "attrs": { "reason": "lost", "quantity": 3, "unit": "character" } }
] }
```

- `form` is the diplomatic form (the word as the witness writes it), `norm` the normalized form when it differs. `joinNext: true` says this token and the next are one word. `sep` records the attested separator before the token. `segment` on an item says a run of that segment begins here (`segmentId: null` means unassigned text begins). `marks` are features; their kinds are TEI element names and `from`/`to` count code points of `form`.
- Edition tokens carry `source`: `{ "kind": "witness", "transcriptionId", "tokenIds" }`, `{ "kind": "conjecture", "conjectureId" }` or `{ "kind": "editor" }`.

## Changesets (`history.ndjson`)

One JSON object per line: `{ "id", "version", "userId", "userName", "at", "ops", "reverse", "message" }`. Operations are: `insert` (after an item id, or `null` for the start), `delete` (ids), `set` (id, fields; `null` means removed), `move` (ids, after), `split` (id, at, newId, join), `join` (id), `replace` (ids, items). Applying every changeset's `ops` in version order to an empty stream gives `transcription.json`; applying a changeset's `reverse` undoes it.

## TEI

`transcription.tei.xml` and `edition.tei.xml` are TEI P5. The subset used is documented in `tei-subset.md` beside this file in the application and as an ODD in `schemas/varians.odd`. Nothing is in the TEI that is not also in the JSON; the TEI is for other tools and for reading, the JSON is complete.

## Rebuilding

`varians import <archive-dir>` reads a directory of this layout into an installation, creating or updating the work, witnesses, transcriptions and editions by id. The round trip export then import is tested on every release.
