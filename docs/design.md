# The design of Varians

This document states how Varians is designed, as it stands. It is the authority on the model and on the decisions behind it: where it and the code disagree, one of them is wrong and is corrected. It has no history. A decision that changes is rewritten here in the commit that changes the code, and what it replaced is left to the git log and to [CHANGELOG.md](../CHANGELOG.md).

It does not repeat what is specified elsewhere:

- [guide.md](guide.md) is how Varians is used, screen by screen.
- [formats/specification.md](formats/specification.md) is the data format, normatively, with its schemas, ODD and example.
- [install.md](install.md) is how an installation is run, with every setting.
- [web-conventions.md](web-conventions.md) is how code in the web application is written.
- [lexicon.md](lexicon.md) is the Greek forms and dictionaries.

## 1. Principles

- **Show the text, hide the machinery.** The main screens are a text with a margin. Tools appear at the selection or in a side pane.
- **Follow the conventions scholars know.** Line numbers in the margin, the apparatus at the foot, a caret, undo, cut and paste. Nothing invents an interaction where a known one exists.
- **Derive, do not record.** What can be computed from the texts (variants, agreement, order, coverage) is computed. Only decisions are stored.
- **Stable identities.** Tokens, segments, witnesses and conjectures have ids that never change meaning. Whatever points at text points at a token. Character offsets are stored nowhere, except inside one token for a feature that covers part of it.
- **One core.** Domain logic lives once, in a library with no dependency on the browser or the database, used unchanged by both.
- **Readable without Varians.** Everything made here exists as open, documented files that the application itself keeps current.
- **Honest refusal over silent guessing.** Where the application cannot know (how to accent a word, which letters a box covers, which of two conflicting histories is right), it asks or marks or refuses. It never fabricates and never overwrites silently.

## 2. Stack and repository

TypeScript throughout. SvelteKit 2 with Svelte 5 for the application and its server, CodeMirror 6 for the editors, OpenSeadragon with tiles made by sharp for facsimiles, PostgreSQL through Drizzle, Tailwind CSS 4 with Bits UI, Vitest and Playwright, pnpm in one repository.

|                 |                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | The domain: streams and operations, moves, reference schemes, normalization and fold, collation, the apparatus, adoption, history and reconciliation, TEI, the other import formats, licences and rights. No browser, no database. |
| `packages/db`   | The schema and the migrations.                                                                                                                                                                                                     |
| `apps/web`      | The pages, the editors, the reader, the API, the server logic, the command line.                                                                                                                                                   |
| `docs/formats`  | The specification of the data format, served by every installation at `/formats/2/`.                                                                                                                                               |

The editors are client applications that hold the model; the server stores and authorizes. The reader is rendered on the server. Collation runs in the browser for what is on screen and on the server for the reader, by the same function.

## 3. The model

The data says _transcription_ where the interface says _transcript_; they are the same thing. This document uses the interface's word.

### 3.1 Work, reference scheme, segment

A **work** is a text as an abstract object. It has a title, an author, a language, typed canonical identifiers (the primary one a CTS URN), a reference scheme and a normalization profile.

A **reference scheme** is an ordered list of levels, each with a label, a sort type and the separator before it in a printed label: book and line, Stephanus page and section, and so on. Level values are free text whatever the sort type.

A **segment** is one address in a work: Iliad 1.5. It is the unit of collation and the unit a reader cites. Segments come into being when text is assigned to them or a conjecture names them. Where the work has a CTS URN, a segment has a passage URN.

### 3.2 Witness, pages, images, boxes

A **witness** is a carrier of the text. Its **category** is manuscript, inscription, edition, indirect or other; the material (papyrus, parchment, paper, or other with free text) and the format (codex, roll, sheet, unknown) are fields of their own, so a papyrus is a manuscript on papyrus. It has a siglum, a name, optional descriptive fields, typed identifiers (Diktyon, Trismegistos, Wikidata, VIAF, URL, other), and a list of **hands**: each with an id, a label, a description, and whether it is the scribe.

A witness has an ordered list of **pages**, each with a label. Fragments are pages. A page may have an image, uploaded and tiled on the server or shown from a library's IIIF server. The IIIF address is set on the Pages screen only. Every image carries a **rights statement** from a fixed list, a credit line and a source; the witness holds defaults for new images, and a IIIF import keeps what the manifest states. An upload without a statement is refused.

A **box** (a zone in the data) is a region of an image linked to one or more tokens, or carrying a feature with no token. Boxes belong to their page.

Pages belong to the witness and are shared by every transcript of it, other people's included.

### 3.3 The transcript: a stream

A transcript is one stretch of a witness as someone transcribes it. Its content is one ordered **stream** of items:

- a **token**: a run of letters with a permanent id, a diplomatic form, a normalized form (null when the same), whether the normalized form is checked, whether it joins the next token into one word, the attested separator before it, a segment start, and marks;
- a **break**: line, column, paragraph or page;
- an **object**: a gap, a figure, a scribal mark, an anchor for a note.

A **word** is the unit of normalization and collation: one token, several joined, or one token whose normalized form holds several words.

Edits travel as small operations on items (insert, delete, set, move, split, join, replace), applied identically by the client and the server through the core.

A transcript is for an ordered list of works, and its text may be assigned to segments of any of them. A witness may have any number of transcripts, of the same work or others; an edition's conspectus names which one stands behind each siglum.

### 3.4 Pages are containers of text

In a transcript each page of the witness has its own text. There is no page break command and nothing to place at a caret. Text on no page is **Not on a page**: where imports without pages land, where the text of a removed page goes, and the whole of a transcript whose witness has no pages. It is text like any other: segmented, collated, exported, published.

The stream keeps this shape, which the system maintains and the editor never sees: first the unplaced stretch, then for each page that has text a page break naming it, followed by that page's items. The invariants every write path keeps:

1. Every page break names a page of the transcript's witness that exists, and carries no label.
2. No page is named by more than one break.
3. The breaks stand in the order of the witness's pages.
4. A page's stretch may be empty; a page without a break has no text. The two mean the same.

So the order of the text is the order of the pages, with Not on a page first. Reordering pages reorders text.

The invariants are kept at the one place every change to a transcript's text passes: the save. The editor makes edits that keep them, but it works from the pages it knows, and a page may be removed or moved meanwhile, a change undone, or the same page begun by two people at once. So when the operations of a save leave the stream out of shape, the server **conforms** it (`conformPages` in the core) as a second changeset, "Pages reorganized", and answers with the text as it now stands, which the editor takes up as it takes up a conflict. A save is never refused for its shape. Whatever writes a transcript's whole content or changes a witness's pages conforms as well: replacing content, bringing back a version, importing an archive, removing or reordering pages. The format still allows page breaks without a page; Varians conforms them on import.

**Text is placed by moving it**: Move to Page… on a selection, and cut and paste within one workbench, move words with their ids, features, segments and history. Copy and paste makes new words. Words that move to another page lose their boxes.

**Removing a page never deletes text.** Its text goes to Not on a page in every transcript of the witness, as a change in each transcript's history made by the maintainer who removed the page. The image and its boxes go with the page. Removal is never refused.

**Columns** are breaks within a page's text. A roll's columns may be registered as pages.

### 3.5 Segments are independent of placement

A token belongs to the segment whose start last preceded it in the stream, across page breaks and across the boundary of the unplaced stretch. A token before any start, or after a start naming no segment, is unassigned. A segment standing in several places has several runs, ordered by part number. Labels show in the gutter, never as objects in the text; a page's first line shows, muted, the segment it continues.

**No move changes the segment any word belongs to**: not Move to Page…, not cut and paste, not the removal or reordering of pages, not conforming. Where the flow would give a word another segment, the move writes an explicit start, and part numbers keep the content order (`moveRun` and the one start repair in `packages/core/src/stream/move.ts`).

### 3.6 Diplomatic form, normalized form, fold

- The **diplomatic form** is the record of what is written. Normalization never alters it.
- The **normalized form** is the editor's statement of which word is written. The apparatus is built from normalized forms, so a difference the editor judges to be spelling never reaches it.
- The **fold** is the mechanical comparison key: Unicode composition, case, the marks of elision and, by the work's profile, diacritics. Words are aligned by their letters alone. A grave counts as an acute.

The profile proposes a normalized form only where that is mechanical. Nothing adds accents or breathings automatically. A normalization memory per transcript remembers confirmed pairs. A normalized form that differs from its diplomatic form by more than the profile's rules is unchecked until confirmed.

Every place of variation has a **kind**: _textual_ where the readings have different letters, _interpretative_ where they have the same letters read otherwise (accents, breathings, punctuation, word division). The kind is computed, and the editor can override it per place. The edition chooses how interpretative variants are printed; the reader may choose otherwise. In Greek works a textual reading is further labelled by the analyser of forms as a help, never as a filter. The apparatus has no layer of orthographic variants: how a witness writes is its diplomatic text.

Word division is the editor's analysis. What the manuscript has between two words is recorded separately and can be shown as written.

### 3.7 Features, corrections, states

A **feature** is a typed annotation on tokens, on characters within one token, on a range, at a point, or on a box. Its kinds are a curated subset of TEI, so every feature has an exact TEI rendering. Features never affect the text string, and the editor never shows markup. Leiden conventions are accepted as fast entry and converted.

A deletion or an addition is a **correction** and may name its **hand** (one of the witness's hands, the scribe, or another) and its **stage**. An edition's conspectus can give a witness several **states**, each under a siglum of its own: the original, a stage, a hand. Collation reads the transcript in the state asked for, so the recording differs per witness without a different model per witness.

Collation reads words, not features. Text in a gap is not attested: a gap absorbs what the others have there, and the apparatus says the witness is lacunose, not that it omits.

A reading the manuscript itself offers as an alternative is entered as a variant on the words it concerns.

### 3.8 Conjectures and reported readings

A **conjecture** belongs to the work and names a segment: its kind, the lemma as text, the proposed reading, the proposer as free text (distinct from the user who entered it), references, a note. It is anchored by its lemma, matched by fold within the segment, with a token anchor to resolve a lemma that occurs twice. A conjecture whose lemma no longer matches is listed at its segment for re-anchoring.

A **reported reading** is what a witness is reported to have at a place without being transcribed there. It is stored like a conjecture and takes part in collation as a witness present at that site only.

### 3.9 The edition

An edition's text is a stream of the same shape as a transcript's, with the edition's own lineation and objects (speaker labels, headings, lacuna marks, marginal notes). Every word carries its **source**: the witness tokens it was taken from, the conjecture it realizes, or the edition itself. Adopted conjectures are also listed on the edition, so that deletions, lacunae and transpositions are attributed.

- An edition starts by copying a witness's text for a range of segments. From then on it is independent; where a source transcript is corrected later, the word is marked and the current reading offered.
- Adopting a reading replaces the edition's words at the site with that reading's words and their source. A word the editor retypes becomes the edition's own, so that no witness is credited with an emendation.
- Transpositions are cut and paste; the report of them is derived.
- Editorial sigla in the printed text are features rendered by the edition's convention, never typed characters.
- Site review state names the edition's tokens at the site, so a later change there makes it unreviewed again.

### 3.10 Collation and the apparatus

Collation is a pure function in the core: given the words of one segment in the edition and in each witness, it returns the segment's **sites**. It references nothing stored. The server caches results under a hash of the inputs.

Per segment: the edition's words form the initial graph; each witness is aligned to it progressively by dynamic programming over fold keys; words unmatched on both sides with the same key are a transposition; each maximal run between positions of full agreement is one site, with readings grouped by fold key and keeping the token ids they were read from. Conjectures and reported readings are attached to sites by lemma. Whole-segment order is compared outside the aligner.

**Coverage.** A transcript covers the span from its first to its last segment of the work. Within that span, a segment it has no words for is an omission, and one lying across a gap or lacuna object is lost. Outside the span the witness is not transcribed, and the apparatus is silent.

**A witness lacking a whole segment** is left out of that segment's alignment, and the segment gets one further site of its own, flagged _wanting_, covering the whole segment: "om. B", or "deest in B" where lost. It overlaps the segment's other sites and is taken as the active site only when the whole segment is selected, so a conjecture on one word stays on that word. Its lemma is abridged to the first and last word when the segment has more than three.

Alignment constraints (these witness words correspond to these edition words) are stored and archived as data that names tokens.

### 3.11 People, ownership, visibility

**Accounts and persons are distinct.** Every account is a person under the same id; a person may have an ORCID and need not have an account here. Authorship (changesets, moments, notes) points at persons. Ownership and permissions stay with accounts.

**The shared registry**: works, witnesses, reference schemes, the bibliography. Anyone signed in may create an entry; search before creation and typed identifiers make duplicates visible; duplicates are merged, by administrators or by someone who maintains both entries, and the merged id keeps resolving. Each entry has maintainers. Using an entry needs no permission. A registry entry is not deleted while another user's work depends on it, and a witness is deleted from its own page, where the menu says why when it cannot be.

**Owned records**: transcripts, conjectures, reported readings, editions. The edition is the project: its owner invites collaborators, and the grant reaches the owner's transcripts in its conspectus and the owner's conjecture records on the work. Site roles: member, editor (may edit anything; may not delete, publish, grant or merge), administrator.

**Visibility.** A work is public by default or private; a private work is private throughout. Owned records are drafts until published. Publishing an edition publishes the owner's transcripts in its conspectus and the owner's conjectures and reported readings on the work, and is refused while the conspectus names another person's unpublished transcript. Readers see published conjectures and reported readings only. In a public work, published conjectures are a commons any edition may adopt.

**A published version is fixed.** It records the conspectus and the version of every transcript it compares, and collates against exactly those. Correcting a witness later changes the draft's apparatus, never a published one.

**Copies.** A published edition or transcript can be copied into a draft of one's own, with its origin recorded. Registry entries are shared, never copied.

### 3.12 History

Every save is a **changeset**: the operations, their reverse, the person, the time. Changesets are the save protocol itself, kept for every transcript and edition from its first save, with full states checkpointed at intervals.

- The history is shown as sessions and **moments**; any moment can be opened read-only with its changes marked. Named moments are what readers link to; publishing names one.
- Bringing back a segment, a page or the whole text, and undoing one earlier change, are new changesets. History is never rewritten.
- Review goes through the changes since a moment, with accept, reject and later; each person's position is kept.

**The history is a graph.** Every changeset names its parent; the version number is this installation's local order. Bringing in another installation's history (`reconcile` in the core) is one of: nothing to do; a fast-forward; a merge; or a conflict. A merge needs two things. The two sides touched different items; and, since a word's segment depends on what stands before it (3.5), no word would end in a segment that neither side gave it: a word the other side left in its segment keeps the segment it has here, and a word the other side gave another segment ends in theirs or in ours. Two people numbering different passages therefore merge; a word moved on one side to a place whose segment the other side changed does not. A conflict is refused and reported, never resolved by guessing. The person may then keep ours (theirs is stored unapplied) or take theirs (ours is first named as a moment).

### 3.13 The archive and the data format

The archive is the preservation record, and it is complete: every table of the schema is classified as archived, derived or transient, and a test fails when a table is added without a classification. The database dump is an operational convenience.

The server keeps a git repository of open files per work: TEI, JSON with schemas, biblatex, Markdown, plain text and the images. The files are kept current: triggers on the archived tables fill a queue, and a worker rewrites the touched parts after a short quiet. Commits mark named moments and publications, authored by the person, and a nightly pass.

The files conform to the **Varians Data Format, version 2**, specified in [formats/specification.md](formats/specification.md). The specification changes before the code. Within a version, readers ignore what they do not know and a field never changes meaning. The importer reads version 1.

The TEI carries the scholarship: edition words point at the witness tokens or conjecture they came from, segments carry passage URNs, headers carry the licence and the contributors. Process state (reviews, history, unchecked flags) stays in JSON.

Every record has an address, `/id/<id>`, which resolves to its page, or as JSON to its archive representation, under the same visibility rules as the pages.

### 3.14 Packages, import and sync

One **package** format serves every scope (a work, an edition, a transcript, a set, an installation): a BagIt zip with RO-Crate metadata around the archive layout. A partial package carries what it depends on at the versions it needs.

**Import** reads packages, bare archives and both format versions, in one transaction; its preview is the same import rolled back. Registry records are matched by id, then through recorded merges, then by a canonical identifier. Persons are matched by id, then ORCID. An import over the web by someone who is not an administrator is **restricted**: it changes only what that account may change, brings new records in as the account's drafts, and never publishes, moves ownership or grants. The command line imports as the operator.

**Sync between installations is explicit**: a maintainer pulls a public work from another installation, or pushes with a token, and reads the report. There is no live replication. Licence compatibility is checked before anything is written.

### 3.15 Licences, terms, rights

- The application is AGPL-3.0-or-later; `packages/core` is Apache-2.0; the specification is CC BY 4.0 and its schemas, ODD and RelaxNG are BSD-2-Clause. The footer links the source of the running version.
- Scholarly records in public works carry the installation's data licence (`DATA_LICENCE`; CC BY-SA 4.0 by default), fixed on a record at its first publication. Registry entries are CC0.
- **Terms of contribution** ([terms.md](terms.md)) are versioned, accepted at registration and again when they change. Until an account accepts the current version it reads and changes nothing.
- An image is copied into archives and packages only when its rights statement allows copying; otherwise only its source address travels.

### 3.16 The dictionaries

The Greek forms and the two dictionaries are not part of Varians. They are built once from their sources and travel as one file that installations import ([lexicon.md](lexicon.md)). Neither the sources nor the built file is in the repository.

## 4. The interface

- **Written for scholars of textual criticism.** No lead paragraph under a heading, no hint under a field unless it states a convention of Varians that cannot be inferred (an identifier's form, what visibility does, what a deletion takes with it). Explanations belong in the guide, which every installation serves at `/guide`.
- **Fixed terms**: work, witness, transcript, edition, segment, page, siglum, conjecture, reading, diplomatic and normalized, interpretative variants, Not on a page. "Text" is never a synonym for a work.
- **Labels** are nouns and short verbs, without example placeholders. Menu items are in Title Case; buttons, labels and headings in sentence case.
- **One search**, in the header.
- **Arranged by the work a scholar does**, not by kinds of data. For a witness: describe it, add its pages and images, transcribe, segment, map. For a work: register it, gather its witnesses, make the edition, publish. The workbench is arranged this way; the other screens are still to follow (section 7).
- **The workbench**: above the text, the page chooser with its arrows, the form, Insert and Tools; in the header, the witness and transcript, the pane toggle and the ⋯ menu; under a selection, the toolbar with the features, Move to Page…, Segment… and Map. The facsimile stands on the side the editor chooses. The whole text is a read-only view. Words are mapped only in a page's own view. What the browser remembers (the view, the side, the pane's width) is kept in the browser, not in the account.
- **The edition editor and the reader** show the page a witness's words stand on, whether or not the words are mapped.
- Editor and reader are separate surfaces over one model. The reader is citable to the segment, with a lasting address for every published version, and prints.

## 5. Operations

- **Authorization is on the server**, for every request. Addresses the server is asked to fetch must be public ones, checked at every redirect. Authentication, mail, downloads, imports and record addresses are rate limited.
- **Migrations run on real data** and add. A migration that drops or changes a column says so in the changelog, and a backup is taken first.
- **Installation**: Docker Compose is the primary path, a native install from the same release tarball the second. Releases are tagged, built by CI, and published as an image and tarballs. Mail goes over plain SMTP and is optional.
- **Versions**: the application's version is semantic, with the commit as build metadata; the format's version is separate.
- **Dependencies** must be compatible with AGPL-3.0; a check in CI fails on any that is not.
- **The repository is public**, and names no particular server: nothing about a deployment's host or its accounts is in tracked files.

## 6. Set aside

Decided against, and not to be proposed again without a new reason:

- A desktop program, a portable single-user installation, a static-site export of published versions.
- Pushing archives to a remote, and deposits with persistent identifiers. The archive is a plain git repository, so either can be added without changing it.
- Simultaneous editing with shared cursors, and a CRDT. Conflict detection with a merge of non-overlapping edits is enough.
- Text recognition inside Varians. PAGE and ALTO output is imported.
- Page breaks as things in the text: the page break command, a rule with a page's label, an editable whole text, a page's removal refused or forced.
- A layer of orthographic variants in the apparatus.
- An interface language other than English, though every string is in one place.

## 7. Not built, and known gaps

Designed or wanted, and not there:

- The arrangement of the witness, work and edition screens along the workflows of section 4. This is the next piece of design.
- Dissemination: DTS, IIIF Presentation manifests with word annotations, a CollateX export.
- An interface for alignment constraints, and for splitting and merging sites.
- Thinning of old history (the core has the function; nothing applies it).
- Comments on other people's records; typeset PDF export (the reader prints through the browser); virtualized long lists; re-encoding of uploads.
- Works are still deleted from their Edit page, not from their own page as witnesses are.

Known gaps in what is built:

- Adopting a whole-segment omission removes the segment from the edition's text, apparatus entry included. An omitted line cannot yet be printed in brackets.
- Undoing a move of text to another page does not bring back the boxes the move detached.
- The pages endpoint of a witness reads every transcript to count the words on each page, which will be slow for many long transcripts. A count kept with the segment index is the remedy.
- In the edition's TEI an adopted conjecture's name and a conjecture's source are text in pointer attributes; they should be `conj:` pointers.
- A merged or deleted work's archive directory stays on disk.
- Client-only packages are runtime dependencies, which enlarges the production install.
- Records published before licences existed have none until published again; images uploaded before rights statements existed stay out of archives until given one.
- Narrow screens are unchecked.
