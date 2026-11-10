# Varians Data Format, version 2

This document specifies how Varians writes a scholarly work, its witnesses, transcriptions and editions as files: the archive of one work, and the package that carries one or more archives between installations. It is written so that the files can be read, checked and rebuilt without Varians, and so that another program can write files that Varians reads.

The key words _must_, _must not_, _should_ and _may_ are to be read as in RFC 2119. A _writer_ is a program that writes files of this format; a _reader_ is one that reads them.

Address of this version: `https://varians.eu/formats/2/`. Every installation of Varians serves the same documents at `/formats/2/`.

## 1. Conformance

A conforming archive has the layout of section 3, every JSON file in it is valid against the schema its `$schema` names, every TEI file in it is valid against `varians.rng`, and the references between files resolve as section 4 says. The example archive in `example/` is a conforming archive and the target for other implementations.

The JSON Schemas are published at `https://varians.eu/formats/2/<name>.schema.json`; the TEI customization is `varians.odd`, with the RelaxNG schema `varians.rng` generated from it. Where this document and a schema disagree, this document is right and the schema is to be corrected.

## 2. General rules

- **Encoding.** Every text file is UTF-8 without a byte order mark, with line feeds. Text is in Unicode normalization form C, except where a transcription records a form as written (`form`), which keeps the code points the transcriber entered.
- **JSON files** are objects, indented by two spaces, ending with a line feed. The first key of every JSON file is `$schema`, whose value is the `$id` of the file's schema. A JSON file never has an array at its top; a list is a named member of the object.
- **NDJSON files** (`history.ndjson`) hold one JSON object per line, without `$schema`; each line is valid against the schema the specification names for it.
- **Identifiers.** Every record has an `id`, a string unique across installations. Varians writes ULIDs (26 characters of Crockford's base 32); readers must treat ids as opaque strings and must not derive meaning from them. Ids are the links between files: slugs in paths are for people, ids are for programs. A record keeps its id for ever, also when it moves to another installation.
- **Times** are ISO 8601 in UTC with milliseconds (`2026-11-09T14:03:27.115Z`).
- **Absent and null.** A member that is `null` has no value. A reader must treat an absent optional member as `null`.
- **Unknown members.** Readers must ignore members they do not know. Writers must not give a known member another meaning (section 12).

## 3. Layout of an archive

An archive holds one work, in a directory named by the work's slug:

```
<work-slug>/
  README.md                      a short orientation: this layout, the format version, the address of this specification
  LICENSE.md                     the licences of the files, by kind (section 10)
  work.json                      the work
  persons.json                   every person the files refer to
  segments.tsv                   the work's segments, in order
  conjectures.json               conjectures on the work
  reported-readings.json         readings reported for witnesses
  bibliography.json              every bibliography entry the files cite
  bibliography.bib               the same entries as biblatex
  citations.json                 which record cites which entry
  witnesses/<witness-slug>/
    witness.json                 the witness
    pages.json                   its pages, with their images
    images/<file>                uploaded images whose rights allow copying (section 10.3)
    transcriptions/<name-slug>/
      transcription.json         the transcription and its text
      transcription.tei.xml      the same as TEI
      transcription.txt          the read text, for a quick look
      zones.json                 image zones
      memory.json                the normalization memory
      reviews.json               each person's review position (optional)
      history.ndjson             every changeset
      moments.json               named and published moments
  editions/<edition-slug>/
    edition.json                 the edition: metadata, conspectus, adoptions, notes, text
    edition.tei.xml              the critical text with apparatus, as TEI
    edition.txt                  the text with the apparatus under each segment
    edition.md                   the same as Markdown
    alignment.json               the editors' constraints on the alignment
    reviews.json                 sites looked at, and review positions
    history.ndjson, moments.json as for transcriptions
  schemas/                       copies of the JSON Schemas (informative)
  tei-subset.md                  a readable account of the TEI used (informative)
```

A witness is in a work's archive when one of its transcriptions is, when an edition's conspectus names it, or when a reading is reported for it. A transcription is in a work's archive when its owner chose it for the work, when its text is assigned to a segment of the work, or when a conspectus of one of the work's editions names it. An archive written for one person (a download) holds only the records that person may see; an edition they may not edit is written as its latest published version, with its history up to that version.

`.txt`, `.md`, `README.md`, `schemas/` and `tei-subset.md` are for people and other tools; a reader rebuilding the records must not depend on them.

## 4. The records

Each file below lists its members. The schema is the full statement; types are given here only where they help.

### 4.1 `work.json`

| Member                   |                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatVersion`          | `2`.                                                                                                                                                                                   |
| `id`, `slug`, `title`    | The work's id, its slug (lower-case letters, digits and hyphens) and its title.                                                                                                        |
| `author`                 | The author as cited, or null.                                                                                                                                                          |
| `language`               | A language code (ISO 639-3 where one exists): `grc`, `lat`, `la`, `heb`, `ara`, `san`.                                                                                                 |
| `identifier`             | The work's primary CTS URN, or null.                                                                                                                                                   |
| `identifiers`            | Further canonical identifiers: a list of `{ scheme, value }` (section 7).                                                                                                              |
| `description`            | Free text, or null.                                                                                                                                                                    |
| `visibility`             | `public` or `private`.                                                                                                                                                                 |
| `scheme`                 | The reference scheme: `{ id, name, levels, createdBy, createdAt }`, where `levels` is a list of `{ key, label, type, separator }` and `type` is `number`, `roman`, `letter` or `text`. |
| `profile`                | The normalization profile: `language`, `fold` (the folding options: what collation ignores), `lowercaseCapitals`, `finalSigma`, `expandAbbreviations`, `latinUV`.                      |
| `maintainers`            | The accounts that maintain the work here: `{ id, name, since }`.                                                                                                                       |
| `licence`                | The licence of the records in this archive that have no licence of their own (conjectures, reported readings, notes), as an SPDX identifier (section 10).                              |
| `createdBy`, `createdAt` | The account that registered the work, and when.                                                                                                                                        |

### 4.2 `persons.json`

`{ "persons": [ { "id", "name", "orcid" } ] }`: every person a file of the archive refers to by `personId`, `createdBy` of a moment, or the like. `orcid` is the 19-character form (`0000-0002-1825-0097`) or null; a reader should check its checksum (ISO 7064 MOD 11-2). A person is not an account: they may have no account on any installation.

People appear in two ways. _Persons_ made or did something: changesets, moments, notes, collaborators, site reviews, site kinds and review positions name them by `personId`. _Accounts_ own or maintain records on the installation that wrote the archive (`ownerId`, `maintainers`, `createdBy` of registry records); they are given with `id` and `name` for reading, and do not travel between installations: an importer gives records whose owner has no account there to the person importing.

### 4.3 `segments.tsv`

Tab-separated, with a header line: `id`, `label`, `sort_key`, `address`, `urn`, `created_at`, one segment a line in the work's order. `address` is a JSON object from level keys to values (`{"book":"1","line":"5"}`); `label` is the address as printed (`1.5`); `sort_key` orders segments as strings; `urn` is the passage's CTS URN when the work's identifier is a CTS URN (the work URN, a colon, and the address values joined by full stops: `urn:cts:greekLit:tlg0012.tlg001:1.5`), else empty. Fields contain no tabs or line breaks.

### 4.4 `conjectures.json`, `reported-readings.json`

`{ "conjectures": [...] }` and `{ "readings": [...] }`. A conjecture: `id`, `workId`, `segmentId`, `segmentLabel` (informative), `kind` (`substitution`, `deletion`, `addition`, `lacuna`, `supplement`, `transposition`), `lemma` (the words concerned), `reading` (the proposed words; empty for a deletion or lacuna), `extent` (of a lacuna), `proposer`, `note`, `sequence` (segment ids, for a transposition), `supplementsId` (the lacuna a supplement fills), `anchor` (the witness or edition tokens it was registered from), `ownerId`, `visibility` (`draft` or `published`), `createdAt`, `updatedAt`. A reported reading: `id`, `workId`, `segmentId`, `witnessId`, `lemma`, `reading`, `source` (where the report comes from), `note`, `ownerId`, `visibility`, `createdAt`, `updatedAt`.

### 4.5 `bibliography.json`, `bibliography.bib`, `citations.json`

`{ "items": [ { "id", "entryType", "citationKey", "fields", "label", "createdBy", "createdAt", "updatedAt" } ] }`: every entry cited by a record of the archive; `fields` are biblatex fields as strings, `label` the short form printed in an apparatus (`West 1998`). `bibliography.bib` is the same entries as biblatex. `{ "citations": [ { "id", "itemId", "conjectureId", "reportedReadingId", "noteId", "editionId", "segmentId", "prenote", "postnote", "position", "createdAt" } ] }`: one citation of an entry by a record (exactly one of the record members set, except a note's citation, which names the note and its edition).

### 4.6 `witness.json`

The witness: `id`, `slug`, `siglum` (proposed for conspectus), `name`, `category` (`manuscript`, `inscription`, `edition`, `indirect`, `other`), `format` (`codex`, `roll`, `sheet`, `unknown`, or null), `sourceAuthor`, `sourceWork` (for an indirect source), `repository`, `settlement`, `shelfmark`, `identifier` (a catalogue number), `identifiers` (section 7), `dateText`, `material`, `extent`, `hands` (`{ id, label, description, main }`; corrections in transcripts name a hand by `id`), `provenance`, `description`, `iiifManifest`, `imageRights`, `imageAttribution` (the defaults for new pages, section 10.3), `maintainers` (`{ id, name, since }`), `createdBy`, `createdAt`, `updatedAt`.

### 4.7 `pages.json`

`{ "pages": [ { "id", "label", "position", "image", "createdAt" } ] }` in order. `image` is null or `{ kind, path, file, iiif, width, height, tiles, rights, attribution, source }`: `kind` is `upload` or `iiif`; `file` is the image's path in the archive (`images/12r-a1b2c3.jpg`) or null when the image is not copied; `path` and `tiles` are where the installation keeps the original and its tiles (informative); `iiif` is the base address of a IIIF Image API service; `rights` a rights statement (section 10.3), `attribution` the credit line the rights holder asks for, `source` where the image was obtained.

### 4.8 `transcription.json` and the stream

`id`, `name`, `witnessId`, `ownerId`, `ownerName`, `visibility`, `version` (the number of changesets applied here), `head` (the id of the last changeset, or null), `keepsWrittenForm`, `displayAsWritten`, `profile` (overrides of the work's profile, or null), `description`, `sources`, `licence` (SPDX identifier, set at publication, or null), `rightsNote` (free text, or null), `workIds` (the works its owner chose it for, in order), `createdAt`, `content` (the stream).

The **stream** is the text, `{ "items": [...] }`, an ordered list of items, each with a permanent `id`:

- A **token** (`kind: "token"`) is a run of letters on one line of the carrier: `form` (the diplomatic form: the word as written), `norm` (the normalized form, where it differs; spaces divide it into words for collation), `unchecked` (the written form changed after the read form was confirmed), `joinNext` (this token and the next are one word, divided at a line's end), `sep` (`space`, `none`, `interpunct`, `other`: what the carrier has before it), `segment`, `marks`, and in editions `source`.
- A **break** (`kind: "break"`) is `type` `line`, `column`, `page` or `paragraph`, with `pageId` for a page break, `label` (a page or column name when the page is not registered), `rend` (the layout of the line that begins: `ltr`, `rtl`, `vertical`, `circular`, `boustrophedon`, `retrograde`). In a transcription, the items before the first page break stand on no page of the witness, and each page break opens the text of the page it names; Varians writes page breaks that name pages of the witness, once each, in the order of the pages, without `label`, and a reader conforms any other page break it imports to that shape (one naming no page, or a page the witness lacks, has its text join the text on no page; a second one naming a page has its text join that page's text).
- An **object** (`kind: "object"`) is `type` `gap`, `figure`, `mark`, `note`, `lacuna`, `paratext` or `space`, with `attrs` and `text`.
- `segment` on a token or object: `{ segmentId, part }`; a run of that segment begins here; `segmentId: null` begins unassigned text; `part` numbers a segment's runs in content order.
- `marks` are features of a token: `{ kind, attrs, from, to }`, `kind` a TEI element name (`unclear`, `supplied`, `del`, `add`, `subst`, `abbr`, `hi`, `sic`, `corr`, `damage`, `surplus`, `handShift`, `space`, `gap`, `orig`, `reg`, `num`, `foreign`, `q`, `crux`, `note`, `variant`); `from` and `to` count code points of `form`, and are absent for a whole-token mark. A correction names its hand (`attrs.hand`, a hand id of the witness) and stage (`attrs.stage`).
- `source`, on edition tokens only: `{ kind: "witness", transcriptionId, tokenIds }`, `{ kind: "conjecture", conjectureId }` or `{ kind: "editor" }`.

### 4.9 `zones.json`, `memory.json`, `reviews.json`

`{ "zones": [ { "id", "pageId", "tokenIds", "geometry", "feature", "createdAt" } ] }`: an area of a page image, with the tokens it shows (or a `feature` `{ kind, description }` for something that is not text). `geometry` is `{ rect: { x, y, w, h } }` or `{ polygon: [ { x, y } ] }`, in fractions of the image's width and height from its top left, with an optional `rotate` in degrees clockwise.

`{ "entries": [ { "form", "norm", "count" } ] }`: the normalization memory, written forms with the read forms confirmed for them.

`{ "sites": [...], "states": [...] }`: for an edition, `sites` are the places of variation the editors have looked at, `{ segmentId, siteKey, personId, reviewedAt }`; for both kinds of document, `states` are each person's review position, `{ personId, fromVersion, accepted }` (the version they review from and the changeset ids they have accepted since). Review positions are process state: they are in an installation's own archive and left out of archives and packages made for others.

### 4.10 `edition.json`

`id`, `slug`, `title`, `editors` (the names as printed), `preface`, `ownerId`, `ownerName`, `visibility`, `version`, `head`, `publishedVersion` (the version readers see, or null), `conventions` (apparatus `positive` or `negative`; `latin` abbreviations; `lineation` `verse` or `prose`; `numberEvery`; `speakerDisplay`; `interpretative` `apparatus`, `separate` or `none`; `rest`, the word the apparatus prints for the other witnesses (Varians offers `cett.` and `rell.`), and `all`, the word it prints for all the witnesses (Varians offers `codd.`), each absent where the apparatus names every witness; `sigla` for supplied, deleted, lacuna and crux), `copiedFrom` (the edition this one was copied from, as it was then), `sources`, `licence`, `rightsNote`, `createdAt`, and:

- `sigla`: the conspectus, in order: `{ siglum, witnessId, transcriptionId, states, variantSiglum }`. `transcriptionId` is null for a witness that enters through reported readings only. `states` are further states of the witness collated under sigla of their own: `{ kind: "original", siglum }` (as first written), `{ kind: "stage", stage, siglum }` (after a stage of correction), `{ kind: "hand", hand, siglum }` (with one hand's corrections). `variantSiglum` is the siglum of the variants the manuscript notes.
- `adoptions`: the conjectures the edition adopts, `{ conjectureId, at }`.
- `collaborators`: persons who may edit it, `{ personId, grantedBy, since }`.
- `notes`: `{ id, segmentId, segmentLabel, tokenIds, text, personId, createdAt }`, a note on edition tokens (or the whole segment when `tokenIds` is empty).
- `siteKinds`: the editors' word on the kind of a place of variation, `{ segmentId, siteKey, kind, personId, setAt }`, `kind` `textual` or `interpretative`.
- `content`: the edition's text as a stream (section 4.8), every token with its `source`.

### 4.11 `alignment.json`

`{ "constraints": [ { "id", "segmentId", "baseTokenIds", "transcriptionId", "witnessTokenIds", "createdAt" } ] }`: an editor holds edition tokens to witness tokens, and collation keeps them aligned.

## 5. History

### 5.1 Changesets (`history.ndjson`)

Every change to a document's text is a changeset; a document's history is all of them. One line per changeset, in the order of the installation that wrote the archive:

| Member     |                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | The changeset's id, kept on every installation it reaches.                                                                                    |
| `parentId` | The changeset this one was made on, or null for the document's first.                                                                         |
| `merged`   | For a merge changeset: the ids of the changesets it brings in. Absent otherwise.                                                              |
| `version`  | The changeset's place in this installation's applied order (1, 2, ...), or null for a changeset kept for its provenance and not applied here. |
| `personId` | Who made it, or null.                                                                                                                         |
| `at`       | When.                                                                                                                                         |
| `ops`      | The operations, in order.                                                                                                                     |
| `reverse`  | The operations that undo it, in order.                                                                                                        |
| `message`  | A note on the change, or null.                                                                                                                |

The changesets with a version form a chain: each one's `parentId` (or, for a merge, its `parentId` and its `merged`) is earlier in the file. Applying the `ops` of the changesets with a version, in version order, to an empty stream must give the document's `content`; applying a changeset's `reverse` to the result of its `ops` undoes it. `head` in the document's file is the id of the changeset with the highest version.

### 5.2 Operations

An operation is an object with `t`:

| `t`       | Members                     | Effect                                                                                                                                  |
| --------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `insert`  | `after`, `items`            | Insert the items after the item `after`, or at the start when `after` is null.                                                          |
| `delete`  | `ids`                       | Remove the items.                                                                                                                       |
| `set`     | `id`, `fields`              | Change fields of one item; a field set to null is removed.                                                                              |
| `move`    | `ids`, `after`              | Move a contiguous run of items to stand after `after` (null: the start).                                                                |
| `split`   | `id`, `at`, `newId`, `join` | Divide a token's written form at code point `at`; the first part keeps `id`, the second gets `newId`; `join` marks the two as one word. |
| `join`    | `id`                        | Fuse a token with the token that follows it.                                                                                            |
| `replace` | `ids`, `items`              | Replace a contiguous run of items by other items, keeping the ids the new items carry.                                                  |

### 5.3 Reconciling two histories

When a document arrives from another installation (an import, a package, a pull), the reader compares the two histories by changeset id:

- _Nothing to do:_ every incoming changeset is known.
- _Fast-forward:_ the reader's head is an ancestor of the incoming head (following `parentId` and `merged`); the incoming changesets after it are applied in order, keeping their ids, persons, times and parents, and get local versions.
- _Merge:_ both sides have changesets after their common ancestor, the item ids the two sides touch are disjoint, every item the incoming operations name exists in the reader's text, and no word would change segment unasked (below). The result is one merge changeset by the person importing, with the incoming operations applied on the reader's text, `parentId` the reader's head and `merged` the incoming ids; the incoming changesets are stored with `version` null.
- _Conflict:_ the two sides touch the same items, or an incoming operation names an item the reader has deleted, or a word would change segment unasked. A token belongs to the segment whose start last preceded it, so operations on disjoint ids can still carry a word into another segment. A reader should therefore compare, for every token and object that both texts hold, its segment in the merged text with its segment in the reader's own text and in the incoming text before and after the incoming changesets: where the incoming changesets left its segment as it was, the merged text must give it the segment it has in the reader's text; where they changed it, the segment the incoming text gives it or the one the reader's text gives it. Otherwise the documents conflict. A conforming reader must not resolve a conflict by guessing: it leaves its document as it is and reports the segments concerned. It may then, on the person's choice, keep its own text (storing the incoming changesets with `version` null) or take the incoming text (as a new changeset of the person importing, keeping its prior state as a named moment).

A reader must never overwrite a document's text silently.

### 5.4 Moments (`moments.json`)

`{ "moments": [ { "id", "version", "name", "kind", "number", "basis", "personId", "at" } ] }`: a named point of a document's history. `kind` is `named` or `published`; a published moment carries `number`, the version number readers cite (1, 2, 3), and for an edition `basis`: the conspectus and the version of each transcription the published apparatus was collated against (`{ sigla: [...], versions: { <transcriptionId>: <version> } }`), so that a published version can be rebuilt as it was published.

## 6. TEI

`transcription.tei.xml` and `edition.tei.xml` are TEI P5, valid against `varians.rng`, generated from the ODD `varians.odd`; `tei-subset.md` is a readable account of what is used. The ODD is normative. The TEI is for other tools and for reading; the JSON is complete, and nothing is in the TEI that is not also in the JSON. Process state (reviews, history, unchecked flags) is in the JSON only.

- The header's `<listPrefixDef>` declares the prefixes `tok`, `seg`, `wit`, `conj` and `person`, whose replacement pattern is the installation's address for records, `<origin>/id/$1`, so that `tok:01JC…` resolves (section 8).
- A transcription's words are `<w xml:id="w-<token id>">`; page, column and line breaks are `<pb>`, `<cb>`, `<lb>`; segments begin with `<milestone unit="segment" n="<label>"/>`; zones are `<zone>` in `<facsimile>`, pointed at by `facs`.
- An edition's text is in `<ab n="<label>" xml:id="seg-<segment id>">` per segment, with `corresp` set to the passage's CTS URN where the work has one. Every word is `<w xml:id="w-<token id>">`, with `corresp="tok:<id> …"` naming the witness tokens it was taken from, or `source="conj:<id>"` for a word from a conjecture; an editor's own words carry neither. The apparatus is parallel segmentation, `<app>` with `<lem>` and `<rdg wit="#wit-<siglum>">`.
- The header's `<publicationStmt>` gives the licence as `<availability><licence target="<licence address>">`, and `<titleStmt>` has a `<respStmt>` for every person of the document's history, with `<persName ref="https://orcid.org/<orcid>">` where the ORCID is known.

## 7. Identifiers of works and witnesses

Works and witnesses carry `identifiers`, a list of `{ scheme, value }`, with `scheme` one of:

| Scheme         | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| `cts`          | A CTS URN of a work (`urn:cts:greekLit:tlg0012.tlg001`).        |
| `diktyon`      | A Pinakes/Diktyon number of a Greek manuscript.                 |
| `trismegistos` | A Trismegistos number (texts and objects of the ancient world). |
| `wikidata`     | A Wikidata item (`Q8275`).                                      |
| `viaf`         | A VIAF identifier.                                              |
| `url`          | An address that identifies the record.                          |
| `other`        | Anything else; the value says what.                             |

On import, a work or witness whose id is unknown is matched to an existing one by any identifier of the same scheme and value before a new one is made.

## 8. Addresses

Every record has an address on the installation that holds it: `<origin>/id/<id>`. It resolves to the record's page, or with `Accept: application/json` (or at `<origin>/id/<id>.json`) to the record as this format represents it, subject to the same visibility as the pages. A token's address resolves to its word in the transcript. Records merged into another keep their address, which resolves to the survivor.

## 9. Packages

A package carries one or more archives between installations, and as a preserved copy.

### 9.1 The container

A package is a zip file whose single top folder is a BagIt bag (RFC 8493), named after what it holds:

```
<name>/
  bagit.txt                      BagIt-Version: 1.0, Tag-File-Character-Encoding: UTF-8
  bag-info.txt                   Source-Organization, Bagging-Date, External-Identifier, Varians-Format-Version: 2
  manifest-sha256.txt            the SHA-256 of every file under data/
  tagmanifest-sha256.txt         the SHA-256 of the tag files
  data/
    ro-crate-metadata.json       RO-Crate 1.2 metadata
    <work-slug>/ ...             one archive per work, laid out as section 3
```

A reader must verify the checksums before reading, and must refuse a package whose files do not match them. `External-Identifier` is the address of what the package holds (section 8).

### 9.2 RO-Crate metadata

`data/ro-crate-metadata.json` is an RO-Crate 1.2 metadata document. Its root dataset has `name`, `datePublished`, `license`, `creator` (persons, with their ORCID as `@id` where known), `conformsTo` `https://varians.eu/formats/2/package`, and `hasPart` for every file, each with `encodingFormat` and, for the JSON files, `conformsTo` its schema's `$id`. An image that is not included is an entity with its source address and rights.

### 9.3 Scopes

A package holds a _work_ (the archive as the person making it may see it), an _edition_ (the work's own files, the witnesses of its conspectus with their pages and copyable images, and the transcriptions it names, at the versions its published version was collated against, with history up to them), a _transcription_ (with its works' own files, its witness, pages and images), a _set_ of these, or a whole _installation_. A partial package carries what its records depend on, at the versions they need.

Importing a package is reconciling its documents as section 5.3 says, matching registry records by id and identifiers (section 7), and persons by id, then ORCID (section 4.2).

## 10. Licences and rights

### 10.1 Records

A published transcription or edition carries `licence`, an SPDX identifier fixed at publication from the installation's data licence: `CC0-1.0`, `CC-BY-4.0` or `CC-BY-SA-4.0`. `rightsNote` is free text the maker added. Conjectures, reported readings and notes are covered by `licence` in `work.json`. Registry records (works, witnesses, segments, bibliography) are CC0-1.0.

`LICENSE.md` at the archive's root names the licence of each kind of file, and the licence's address.

### 10.2 Moving records between installations

Records under CC0-1.0 may go to any installation; CC-BY-4.0 to installations whose data licence is CC-BY-4.0 or CC-BY-SA-4.0; CC-BY-SA-4.0 only to installations whose data licence is CC-BY-SA-4.0. A reader must refuse an import that would break this, naming both licences.

### 10.3 Images

Every image has its own rights statement, `rights`, one of these addresses:

- `https://creativecommons.org/publicdomain/zero/1.0/`, `https://creativecommons.org/publicdomain/mark/1.0/`;
- `https://creativecommons.org/licenses/by/4.0/`, `by-sa`, `by-nd`, `by-nc`, `by-nc-sa`, `by-nc-nd` (all `/4.0/`);
- `http://rightsstatements.org/vocab/<statement>/1.0/` with `<statement>` one of `InC`, `InC-EDU`, `InC-NC`, `NoC-NC`, `NoC-OKLR`, `CNE`, `UND`, `NKC`.

The CC0 dedication, the Public Domain Mark, the Creative Commons licences and the `NoC` statements allow an image to be copied: an archive or package must copy only such images into `images/`. For any other statement, `file` is null and `source` says where the image is; the zones are written in every case.

## 11. Sync between installations

An installation exposes, for each public work, `GET <origin>/works/<slug>/sync.json`: `{ "$schema", "formatVersion", "origin", "workId", "licence", "documents": [ { "id", "kind", "head", "version" } ] }`, and the work's package. Another installation compares the heads with its own, downloads the package, and reconciles as section 5.3 says. Private works and drafts answer to a bearer token whose account may see them.

## 12. Versioning

- `formatVersion` in `work.json` is an integer, the format's major version. This document is version 2.
- Additions within a version (a new optional member, a new file, a new value of an open list) are listed in `CHANGELOG.md` with their date.
- Readers must ignore members and files they do not know.
- A member never changes its meaning within a version.
- A new major version comes with an importer that reads the versions before it. Varians reads version 1 archives: their `userId` and `userName` in history, moments and notes become persons, and their top-level arrays are read as the lists they are.
