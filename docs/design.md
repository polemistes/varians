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

A transcript is for an ordered list of works, and its text may be assigned to segments of any of them. Scholia are a work of their own: a transcript that is to be complete includes them, assigned to the segments of that work, not of the text they comment on. A witness may have any number of transcripts, of the same work or others; an edition's conspectus names which one stands behind each siglum.

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

A **feature** is a typed annotation on tokens, on characters within one token, on a range, at a point, or on a box. Its kinds are those of EpiDoc, the TEI of papyri and inscriptions, with what manuscripts need beside them, so every feature has an exact TEI rendering. "Full TEI" is not a vocabulary an application can have: it lets one thing be said in several ways, and EpiDoc is the choice already made for this material. Features never affect the text string, and the editor never shows markup.

**Leiden+** is the notation of papyri.info, defined as another way of writing EpiDoc: every construct of it stands for one element. Varians reads it by writing that EpiDoc and reading the EpiDoc, and writes a transcript out as Leiden+. It is a way in and out, and the conventions a transcript may be shown and typed in; it is never what is stored, since boxes, segments, an edition's sources and the history point at words by identity, which a string of notation does not keep.

**Two things are imported, and they are not alike.**

_A text to start from_ is not a source of the text and not a witness. It is what a transcriber would otherwise type in: an earlier edition's text, taken so that it can be corrected against the witness, after which the witness is the only source there is. Only its words and their numbering are taken, with its lines and paragraphs: no features, none of its editor's marks or notes, no speakers or headings, and not its pages, which are its own edition's and not the witness's. Where it came from is not recorded. Plain text is always this.

_A transcript of the witness made elsewhere_ is a source, and where it came from is recorded. It comes in a transcript's format (TEI, EpiDoc, Leiden notation, the output of text recognition) and is read with its features and its pages.

A TEI file may be either, and the person importing says which before anything is read.

**A transcript holds its witness and nothing an editor added to it.** There are no conjectures in a transcript. When a transcript of the witness is read in:

- Letters supplied where the carrier is lost are left out, and the gap they fill is kept: an object between words, a point mark in a word that the gap breaks. The brackets are the gap.
- A regularization or correction of the scribe's spelling is the word's normalized form. A correction waits unchecked for the editor's confirmation; a regularization does not.
- Letters the source's editor adds as left out, or brackets as written in error, are normalization inside a word, and wait unchecked. A whole word added is left out; a whole word bracketed stays, unmarked, since the witness has it.
- Where the source gives several readings of the carrier (an alternative, a reading corrected since the edition), the one it prints is taken.
- None of what is left out is offered as a conjecture.

A witness registered as a printed edition has no rule of its own: its transcript is made from a text to start from like any other, and what that edition prints is then simply its words.

A deletion or an addition is a **correction** and may name its **hand** (one of the witness's hands, the scribe, or another) and its **stage**. An edition's conspectus can give a witness several **states**, each under a siglum of its own: the original, a stage, a hand. Collation reads the transcript in the state asked for, so the recording differs per witness without a different model per witness.

Collation reads words, not features, and each kind of feature has its rule:

| Features                                                                        | What the apparatus reads                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| unclear, damage, highlighting, glyphs, numbers                                  | the word as read                                                               |
| regularization, correction, abbreviation with its expansion                     | the normalized form                                                            |
| gap, illegible                                                                  | nothing: the witness is lacunose there, and a gap absorbs what the others have |
| deletion, addition, the scribe's correction of a word, hands, marginal variants | the state asked for                                                            |

A word that a gap breaks is not read: what is left of it counts with the gap. The scribe's own correction of a word is two words, one added and one deleted, so that the witness reads the one after correction and the other before it.

A reading the manuscript itself offers as an alternative is entered as a variant on the words it concerns.

### 3.8 Conjectures and reported readings

A **conjecture** belongs to the work and names a segment: its kind, the lemma as text, the proposed reading, the proposer as free text (distinct from the user who entered it), references, a note. It is anchored by its lemma, matched by fold within the segment, with a token anchor to resolve a lemma that occurs twice. A conjecture whose lemma no longer matches is listed at its segment for re-anchoring.

A **reported reading** is what a witness is reported to have at a place without being transcribed there. It is stored like a conjecture and takes part in collation as a witness present at that site only.

### 3.9 The edition

An edition's text is a stream of the same shape as a transcript's, with the edition's own lineation and objects (speaker labels, headings, lacuna marks, marginal notes). In an ancient text the assignment of speakers is interpretation, not text: it is an annotation of the edition and never part of a transcript's words. In a modern play, where the speakers are text, they are written as text. Every word carries its **source**: the witness tokens it was taken from, the conjecture it realizes, or the edition itself. Adopted conjectures are also listed on the edition, so that deletions, lacunae and transpositions are attributed.

- An edition starts by copying a witness's text for a range of segments. From then on it is independent; where a source transcript is corrected later, the word is marked and the current reading offered.
- Adopting a reading replaces the edition's words at the site with that reading's words and their source. A word the editor retypes becomes the edition's own, so that no witness is credited with an emendation.
- Transpositions are cut and paste; the report of them is derived.
- Editorial sigla in the printed text are features rendered by the edition's convention, never typed characters.
- Site review state names the edition's tokens at the site, so a later change there makes it unreviewed again.

### 3.10 Collation and the apparatus

Collation is a pure function in the core: given the words of one segment in the edition and in each witness, it returns the segment's **places** of variation (in the code, sites). It references nothing stored. The server caches results under a hash of the inputs, one row for each segment of an edition: the cache is read for the segments asked for in one statement, and what it lacks is collated and written back together. The runs of a text are found once for the text, not for every segment asked. Which witnesses order whole segments otherwise than the edition is worked out when the orders differ, and remembered for the pair of orders.

Per segment, every witness is aligned with the edition's words alone, by dynamic programming over the letters of the words. What one witness reads therefore never depends on another witness, nor on the order of the sigla. Where a witness departs from the edition it does so over an extent of its own:

- a word read otherwise, together with the words the witness adds beside it (one word against several is one reading);
- words added between two of the edition's;
- words left out: a word left out beside one read otherwise is a departure by itself, unless the letters show the edition's two words to be the witness's one (φί λος against φίλος);
- a stretch lost: a gap in the witness reaches over the words it has nothing for on either side;
- a stretch whose words stand in another order, a transposition, the shortest such stretch being taken.

**A place is an extent over which some witness departs.** The witnesses departing over that extent are its readings, grouped by fold and keeping the token ids they were read from; every other witness that has the segment stands with the edition there. Three rules settle how places stand to one another:

- **A reading in words accounts for every witness over its whole stretch.** Where a witness has a transposition or a phrase for a phrase, any other witness that departs within that stretch (a word spelt otherwise, a word left out) is given its words over the whole of it, with what it adds at either end; and two such readings that overlap without one lying within the other are one place over both. So the entry says of every witness what it has for the phrase, as a printed apparatus does: "νὴ τὸν Δία καὶ] καὶ νὴ Δία A B : νὴ τὸν Δία C".
- **An omission or a loss swallows nothing.** What a witness leaves out or has lost keeps its own extent, and what others read otherwise inside that stretch are places of their own, in which the witness of the omission does not stand: "quick … jumps] om. B" beside "brown] red C". A witness that has lost something within a reading in words is not drawn into it either: its loss and what it reads beside it keep their places. A witness that departs only within a place, in places of its own, stands with the edition at that place.
- Neighbouring places that divide the witnesses in the same way are one place, so that a phrase a family reads otherwise is one variant and not a row of single words. A place where only the reading of the letters differs is not joined to one where the letters do.

In the list of a segment's places, a place lying within another stands before it, so that the first place found for a word is the narrowest. Conjectures and reported readings are attached to places by lemma. Whole-segment order is compared outside the aligner.

**What the apparatus prints.** An entry is a place with its lemma (the edition's words there), the witnesses of each reading, and the conjectures and reported readings attached to it. Entries stand in the order of the text, a wide place before the places within it. A lemma of more than three words against which nothing is read (the witnesses of the place leave it out or have lost it, or only conjectures concern it) is abridged to its first and last word. The edition's conventions settle how the witnesses are named:

- a positive apparatus names the witnesses that agree with the lemma, a negative one only those that differ;
- a **family siglum** stands for its members wherever all of them have a reading ("p" for the agreement of two manuscripts). The editor makes it with the conspectus, from at least two of its witnesses and with a note if wanted ("consensus codicum Vp2H"), under a siglum that no witness, state or other group has. It follows its members through every change of the conspectus: a member whose siglum changes is renamed in it, a witness that leaves the conspectus leaves its groups, and a group left with fewer than two members goes. The reader's conspectus lists the groups with their members and notes;
- a word for **the other witnesses** (cett., rell.) stands for the witnesses of the most widely attested reading of an entry, when they would be three sigla or more; where that reading is not the lemma's, the lemma's witnesses are named, in a negative apparatus too;
- a word for **all the witnesses** (codd.) stands where the lemma is in no witness and all of them have one reading against it.

The editor may give a place a kind over what its letters say (section 3.6), or mark it **not reported**: the place then stays in the editor's view and is left out of the apparatus.

**What a page is given of an edition.** No page needs the whole edition collated before it opens. The collation of a segment is large (every witness's words at every place), the places where the text varies are small, and what each surface does with them differs.

- The **editor** opens with the text, the apparatus of the first segments, and the order statements. It asks for the apparatus of the segments around the caret as the caret reaches them (a stretch each way, so that moving on does not ask again at once), and, once open, for the **outline** of the whole text: for each segment, the places that show (their words, review key and whether they need attention) and the words that have drifted. The outline marks the words, counts the places still to review and steps from one place to the next, which the editor does over the whole text; a place in a segment not yet given is found by asking for that segment first. What an edit touches is asked for again and the outline of those segments made again from it.
- The **reader** is sent the whole text and, for each segment, its places with their readings, the texts that have each named by place in one list of the page's texts, and what is attached. It prints the apparatus, marks the words and opens a place from that. It is not sent the words each text has at each place, nor how each text lines up with the edition; those come, for the segments in view, when a panel needs to light a witness's words. A reader does not wait for the whole text to be collated either: of the segments the cache lacks it takes a hundred, those nearest the one the visitor came to, and names the rest, whose places the page asks for as it opens and sets in the text as they come (so that for a visitor without scripts, or one who prints at once, those places lack their apparatus until the cache is filled).
- A **published version** is fixed, and every one of these is asked for at the version the visitor sees, with what the visitor may see.

**Coverage.** A transcript covers the span from its first to its last segment of the work. Within that span, a segment it has no words for is an omission, and one lying across a gap or lacuna object is lost. Outside the span the witness is not transcribed, and the apparatus is silent.

**A witness lacking a whole segment** departs over all of it: the place over the whole segment is flagged _wanting_ and reads "om. B", or "deest in B" where lost, and the witness stands in no other place of the segment. It is taken as the active place only when the whole segment is selected, so a conjecture on one word stays on that word. Its lemma is abridged to the first and last word when the segment has more than three.

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

**The history is a graph.** Every changeset names its parent; the version number is this installation's local order. Bringing in another installation's history (`reconcile` in the core) is one of: nothing to do; a fast-forward; a merge; or a conflict. A merge needs two things. The two sides touched different items, and did not both place something at the very start of the text (nothing would order the two); and, since a word's segment depends on what stands before it (3.5), no word would end in a segment that neither side gave it: a word the other side left in its segment keeps the segment it has here, and a word the other side gave another segment ends in theirs or in ours. Two people numbering different passages therefore merge; a word moved on one side to a place whose segment the other side changed does not. A conflict is refused and reported, never resolved by guessing. The person may then keep ours (theirs is stored unapplied) or take theirs (ours is first named as a moment).

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
- **The texts read are kept.** The server keeps the parsed text of the transcriptions and editions it has read, up to three hundred thousand items (about sixty megabytes), and hands it out again while the row it came from is unchanged, known by the transaction that wrote the row's current version. A text is never changed once loaded. Inside a transaction nothing is kept or handed out.
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
- Showing a transcript in Leiden sigla and typing features with them, and offering the full set of features in the workbench, which today offers a few. The workbench still lets a supplement be marked in a transcript, which the model no longer wants.
- Distinguishing kinds of text in an edition by their styling (the speakers and stage directions of a modern play).

Known gaps in what is built:

- Adopting a whole-segment omission removes the segment from the edition's text, apparatus entry included. An omitted line cannot yet be printed in brackets.
- Undoing a move of text to another page does not bring back the boxes the move detached.
- The pages endpoint of a witness reads every transcript to count the words on each page, which will be slow for many long transcripts. A count kept with the segment index is the remedy.
- In the edition's TEI an adopted conjecture's name and a conjecture's source are text in pointer attributes; they should be `conj:` pointers.
- A merged or deleted work's archive directory stays on disk.
- Client-only packages are runtime dependencies, which enlarges the production install.
- Records published before licences existed have none until published again; images uploaded before rights statements existed stay out of archives until given one.
- Narrow screens are unchecked.
