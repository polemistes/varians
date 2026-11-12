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
- **The screen is the edition.** A digital edition can say of its witnesses and their variants what a printed page has no room for, and Varians is made for that. A convention of printed editions is kept where it carries information or is a name scholars use: sigla, line numbers in the margin, the critical signs in the text. It is not kept where its reason is the space of a page or the flatness of paper: abbreviations, Latin formulae, a negative apparatus, a word for "the other witnesses", abridged lemmata, variants left out for want of room. A print apparatus is one rendition of an edition, made when a printed version is wanted (section 3.10).
- **Report text, not meaning.** The apparatus says what each witness has, and what follows from the text the edition prints. It says nothing of what a reading means or of how it is formed: that is for interpreters, and for the editor's notes.
- **Neutral terms.** Varians says what a witness has and does not measure it against an original. Words are an addition, not an interpolation, and nothing is called corrupt, spurious or inauthentic. What an edition prints is its editor's judgement, and is reported as that.
- **Known interactions.** A caret, undo, cut and paste. Nothing invents an interaction where a known one exists.
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

A **segment** is one address in a work: Iliad 1.5, a Stephanus section. It is what a reader cites and what the words of a transcript are assigned to. It is not a unit of the text: a word may run from one segment into the next, an edition breaks its lines where it will, and collation takes the boundary between two segments as a place where the text may be cut, never as a wall (section 3.10). Segments come into being when text is assigned to them or a conjecture names them. Where the work has a CTS URN, a segment has a passage URN.

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

A **word** is the unit of normalization and collation: one token, several joined, or one token whose normalized form holds several words. A word divided between two lines, or between two segments, is its parts joined: each part belongs to the segment it stands in, the word has one normalized form, and it is compared whole. The hyphen of a divided word is not stored: it is drawn where a line break that is shown falls inside the word, and nowhere else.

Edits travel as small operations on items (insert, delete, set, move, split, join, replace), applied identically by the client and the server through the core.

A transcript is of its witness and has no works of its own. Its works are those to whose segments some of its text is assigned, in the order they first occur in its text, and its text may be assigned to segments of any number of works. The work is chosen where text is assigned (naming a segment, numbering lines, importing), from the works the text is already assigned to or from the registry; the choice is kept for the visit and stored nowhere. A transcript with nothing assigned is of no work: no work lists it, and no work's archive holds it unless an edition's conspectus names it. Scholia are a work of their own: a transcript that is to be complete includes them, assigned to the segments of that work, not of the text they comment on. A witness may have any number of transcripts, of the same work or others; an edition's conspectus names which one stands behind each siglum.

### 3.4 Pages are containers of text

In a transcript each page of the witness has its own text. There is no page break command and nothing to place at a caret. Text on no page is in **Staging**, first in the page chooser: where imports without pages land, where the text of a removed page goes, and where text is typed that cannot yet be placed. It is text like any other: segmented, collated, exported, published. The whole of a transcript whose witness has no pages is text on no page, and no chooser names it.

The stream keeps this shape, which the system maintains and the editor never sees: first the unplaced stretch, then for each page that has text a page break naming it, followed by that page's items. The invariants every write path keeps:

1. Every page break names a page of the transcript's witness that exists, and carries no label.
2. No page is named by more than one break.
3. The breaks stand in the order of the witness's pages.
4. A page's stretch may be empty; a page without a break has no text. The two mean the same.

So the order of the text is the order of the pages, with Staging first. Reordering pages reorders text.

The invariants are kept at the one place every change to a transcript's text passes: the save. The editor makes edits that keep them, but it works from the pages it knows, and a page may be removed or moved meanwhile, a change undone, or the same page begun by two people at once. So when the operations of a save leave the stream out of shape, the server **conforms** it (`conformPages` in the core) as a second changeset, "Pages reorganized", and answers with the text as it now stands, which the editor takes up as it takes up a conflict. A save is never refused for its shape. Whatever writes a transcript's whole content or changes a witness's pages conforms as well: replacing content, bringing back a version, importing an archive, removing or reordering pages. The format still allows page breaks without a page; Varians conforms them on import.

**Text is placed by moving it**: Move to Page… on a selection, and cut and paste within one workbench, move words with their ids, features, segments and history. Copy and paste makes new words. Words that move to another page lose their boxes.

**Removing a page never deletes text.** Its text goes to Staging in every transcript of the witness, as a change in each transcript's history made by the maintainer who removed the page. The image and its boxes go with the page. Removal is never refused.

**Columns** are breaks within a page's text. A roll's columns may be registered as pages.

### 3.5 Segments are independent of placement

A token belongs to the segment whose start last preceded it in the stream, across page breaks and across the boundary of the unplaced stretch. A token before any start, or after a start naming no segment, is unassigned. A segment standing in several places has several runs, ordered by part number. Labels show in the gutter, never as objects in the text; a page's first line shows, muted, the segment it continues.

**No move changes the segment any word belongs to**: not Move to Page…, not cut and paste, not the removal or reordering of pages, not conforming. Where the flow would give a word another segment, the move writes an explicit start, and part numbers keep the content order (`moveRun` and the one start repair in `packages/core/src/stream/move.ts`). There is one exception. Where an edition is made from a witness and the normalized form of a divided word cannot be divided where the witness divides it (the letters do not correspond), the word stands whole with its first part, and a segment that its second part began begins with the next word.

### 3.6 Diplomatic form, normalized form, fold

- The **diplomatic form** is the record of what is written. Normalization never alters it.
- The **normalized form** is the editor's statement of which word is written. The apparatus is built from normalized forms, so a difference the editor judges to be spelling never reaches it.
- The **fold** is the mechanical comparison key: Unicode composition, case, the marks of elision and, by the work's profile, diacritics. Words are aligned by their letters alone. A grave counts as an acute.

The profile proposes a normalized form only where that is mechanical. Nothing adds accents or breathings automatically. A normalization memory per transcript remembers confirmed pairs. A normalized form that differs from its diplomatic form by more than the profile's rules is unchecked until confirmed.

Every variant has a **kind**: _textual_ where the readings have different letters, _interpretative_ where they have the same letters read otherwise (accents, breathings, punctuation, word division). The kind is computed, and the editor can override it per variant. The edition says whether interpretative variants are shown to begin with; the reader may choose otherwise. A reading is never labelled by its grammar or its sense (section 1): the analyser of Greek forms serves the dictionary, not the apparatus. The apparatus has no layer of orthographic variants: how a witness writes is its diplomatic text.

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

| Features                                                                        | What the apparatus reads                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------ |
| unclear, damage, highlighting, glyphs, numbers                                  | the word as read                                 |
| regularization, correction, abbreviation with its expansion                     | the normalized form                              |
| gap, illegible                                                                  | nothing: the witness is not there (section 3.10) |
| deletion, addition, the scribe's correction of a word, hands, marginal variants | the state asked for                              |

A word that a gap breaks is not read: what is left of it counts with the gap. The scribe's own correction of a word is two words, one added and one deleted, so that the witness reads the one after correction and the other before it.

A reading the manuscript itself offers as an alternative is entered as a variant on the words it concerns.

### 3.8 Conjectures and reported readings

A **conjecture** belongs to the work and names a segment: its kind, the lemma as text, the proposed reading, the proposer as free text (distinct from the user who entered it), references, a note. It is anchored by its lemma, matched by fold within the segment, with a token anchor to resolve a lemma that occurs twice. It is placed on the variant over its own words, and never on the variant over a whole segment that a witness is without unless its lemma is the whole segment. A conjecture whose lemma no longer matches is listed at its segment for re-anchoring.

A **reported reading** is what a witness is reported to have at some words without being transcribed there. It is stored like a conjecture and takes part in collation as a witness that is there at that variant only.

### 3.9 The edition

An edition's text is a stream of the same shape as a transcript's, with the edition's own lineation and objects (speaker labels, headings, lacuna marks, marginal notes). In an ancient text the assignment of speakers is interpretation, not text: it is an annotation of the edition and never part of a transcript's words. In a modern play, where the speakers are text, they are written as text. Every word carries its **source**: the witness tokens it was taken from, the conjecture it realizes, or the edition itself. Adopted conjectures are also listed on the edition, so that deletions, lacunae and transpositions are attributed.

- An edition starts empty. Its text is typed, or copied from a transcript of its conspectus for a range of segments, with the transcript's line and paragraph breaks and its divided words, which are the edition's own from then on. This is done as often as wanted, from one transcript for some segments and from another for others, and no transcript is the edition's base: collation compares every witness with the edition's words, wherever they came from. A segment copied that the edition has already replaces the edition's text of it where it stands, with whatever stands in that text (a speaker label, a heading, a note in the margin), after the editor has been told how many segments that is; segments the edition did not have go after the segment of the edition that precedes them in the order of the work, or to the beginning, on lines of their own in verse and in the run of the text in prose. A copy is one change in the edition's history and touches no other record: a note or a review on words it replaced lapses as it does when the words are retyped, and holds again if the copy is undone. The edition is independent of the witness; where a source transcript is corrected later, the word is marked and the current reading offered.
- **Verse and prose.** Every paragraph of an edition's text is verse or prose: the edition says which its text is, and a paragraph can be marked as verse or as prose, which it then is whatever the edition says. The mark stands on the paragraph break that opens the paragraph, and a text may begin with such a break for its first paragraph. This settles how the text is shown and nothing else. In verse the lines are shown as the editor breaks them, whatever the segments, so that the colometry of a lyric passage is the editor's, and a word that a line break divides is shown with its hyphen. In prose the line breaks are not shown: the text runs on to the width of the page and breaks at paragraphs, which are a reader's convenience, and no word is hyphenated. The breaks stay in the text and show again if the paragraph is marked as verse. In the editor, Enter in verse breaks the line, and inside a word divides it; joining the lines gives the word back whole. In prose Enter begins a paragraph.
- Adopting a reading replaces the edition's words at the variant with that reading's words and their source. A word the editor retypes becomes the edition's own, so that no witness is credited with an emendation. Words adopted where the edition had none each take the segment their witness gives them; where they are a segment the edition did not have, in verse they stand on a line of their own, in prose in the run of the text. Adopting that words are not in the text takes them out, and where they were all that stood on a line, its line break with them, in prose as in verse, so that no empty line is kept.
- Transpositions are cut and paste; the report of them is derived.
- Editorial sigla in the printed text are features rendered by the edition's convention, never typed characters.
- The review state of a variant names the edition's tokens there, so a later change there makes it unreviewed again. A variant where the edition has no words is known by the edition's words on either side of it. The review, and the editor's kind and grade of a variant (section 3.10), are kept under the segment the variant begins in, and read for every segment of its passage, so that they hold however the passages are drawn.

### 3.10 Collation and the apparatus

Collation is a pure function in the core: given the words of a stretch of the edition and of each witness, it returns the **variants** (in the code, sites) of that stretch: the extents over which the witnesses differ, each with its readings. It references nothing stored.

**Passages.** The text is collated in **passages**: one segment, or several consecutive segments of the edition taken together. The boundary between two segments is a place where the text may be cut, and it is cut only where nothing can cross it. It is left uncut, and the segments on either side are one passage, where for some witness that is there:

- a word is divided across the boundary, in the witness or in the edition;
- the witness has words at the boundary that the edition does not have, whether its transcript sets them at the end of the one segment, at the start of the other, or in a segment the edition does not print;
- the witness is without all the words of the segment on one side;
- the witness departs from the edition close to the boundary on both sides, within the reach of a transposition, counted in words through segments shorter than that.

Each segment is first collated alone to find this out, and a passage of several segments is then collated whole. A passage is no longer than twelve segments or 240 words; a longer run is cut where the limit falls. A witness's words for a passage are those of its segments in the edition's order, the words of a segment the edition does not print standing after those of the segment that precedes it in the work's numbering.

So a variant belongs to the words it covers and not to a segment. It may lie across a boundary; it is labelled by the segments of its words ("1.5", "1.5–1.6"); and what a witness moves, divides, adds or is without at a boundary is found and reported as it is inside a segment. Assigning the same words to segments otherwise, alike in every text, changes the labels of the variants and nothing else, with the one exception that follows.

**A word that stands twice.** Where the edition has a word twice and a witness has it once, or the reverse, and no word that both have stands between the two, the letters cannot say which of the two stands against the one. The segments say it: a witness's word stands against the edition's word of the segment that the witness's own transcript gives its word to, so that a witness with the word in 1.6 only is without the one of 1.5. Collated apart, two segments say this of themselves, each having only its own words to stand against; the rule makes a passage say the same. It is the one thing a boundary decides, and it decides it only where the letters leave a tie: a word with other accents stands against the word it agrees with whatever its segment, and words a witness merely assigns to the neighbouring segment are still no variant. In the alignment the letters are counted in whole steps and a word against the same word of its own segment in a part of a step, too small for all such words of a passage together to make a step. Where the two equal words stand in one segment nothing tells them apart, and the alignment takes one of them.

The server caches results under a hash of the inputs, one row for each segment of an edition: the segment collated alone, and, with the first segment of a passage of several, the passage collated whole. What a page asks for is planned from the segments alone: the cache is read around the segments asked for, as far on either side as the nearest boundary that is cut and the reach of a link, and what it lacks is collated and written back. The links between passages and the editor's word on the variants are laid over what is cached each time, so that neither collates anything again. The runs of a text are found once for the text, not for every segment asked. Which witnesses order whole segments otherwise than the edition is worked out when the orders differ, and remembered for the pair of orders.

Over a passage, every witness is aligned with the edition's words alone, by dynamic programming over the letters of the words. What one witness reads therefore never depends on another witness, nor on the order of the sigla. Where a witness departs from the edition it does so over an extent of its own:

- a word read otherwise, together with the words the witness adds beside it (one word against several is one reading);
- words it has between two of the edition's, which the edition does not have;
- words it does not have: a word wanting beside one read otherwise is a departure by itself, unless the letters show the edition's two words to be the witness's one (φί λος against φίλος);
- a stretch whose words stand in another order, the shortest such stretch being taken. A word that the witness has in one spot and is without in another, beyond the reach of a transposition and within two dozen words, makes two variants that lead to each other, also where they lie in different passages.

**A variant is an extent over which some witness departs.** The witnesses departing over that extent are its readings, grouped by fold and keeping the token ids they were read from; every other witness that is there stands with the edition. Three rules settle how variants stand to one another:

- **A reading in words accounts for every witness over its whole stretch.** Where a witness has the words in another order or a phrase for a phrase, any other witness that departs within that stretch (a word spelt otherwise, a word it does not have) is given its words over the whole of it, with what it adds at either end; and two such readings that overlap without one lying within the other are one variant over both. So the variant says of every witness what it has for the phrase. A witness that has lost part of the stretch is not drawn into it: it stands only in the variants over the words it has.
- **Words a witness does not have swallow nothing.** The stretch a witness is without keeps its own extent, and what others read otherwise inside it are variants of their own, in which that witness does not stand. A witness that departs only within a variant, in variants of its own, stands with the edition at the wider one.
- Neighbouring variants that divide the witnesses in the same way are one, so that a phrase a family reads otherwise is one variant and not a row of single words. A variant where only the reading of the letters differs is not joined to one where the letters do.

In the list of a passage's variants, one lying within another stands before it, so that the first found for a word is the narrowest. Conjectures and reported readings are attached to variants by lemma. Alignment constraints (these witness words correspond to these edition words) are stored and archived as data that names tokens.

**Who is there.** A variant concerns the witnesses whose text runs through its stretch, and says nothing of the others. A witness is not there:

- where its transcript marks a gap: the carrier is lost or illegible, and the gap reaches over the words the witness has nothing for on either side;
- where its transcript marks a stretch as not transcribed (a gap whose reason is that, the ellipsis of EpiDoc);
- outside the span from the first to the last segment of the work that its transcript has;
- within a wider stretch that it is without: that absence is a variant of its own, and the variants inside the stretch say nothing of the witness.

A witness that has lost any word of a variant's stretch is not there for that variant, since no reading can be assigned to it; at a point between two words it is not there when it has lost the word on either side or has a gap of its own at the point, and words it has directly beside such a gap are not reported. The exception is a variant in which the only other reading is that the words are not in a witness: a witness that has any of the words is there, and stands with the edition, since part of the words is evidence of them.

A loss is therefore not a reading and makes no variant. A witness whose text runs on without the words is there, and its reading is nothing: the words are **not in** it. Varians does not call that an omission, and never infers a loss from the length of what is wanting, be it one line or a hundred. The transcriber sees whether the text runs on within a page or breaks off where a leaf is gone, and marks the gap; a marked gap alone is a loss. Whether an absence is the scribe's own or his exemplar's is interpretation, for a note.

**Whole segments** are no case of their own, with one exception.

- A witness whose text runs on without a whole segment is without a stretch of words like any other. The segments on either side are one passage with it, so that words merely assigned to a neighbouring segment are found where they are. In the editor the variant over the words of a whole segment is taken as the active one only when the whole segment is selected, so that a conjecture on one word stays on that word.
- A segment that some witnesses have and the edition does not print is words where the edition has none: a variant at a point, in the passage of the edition's segment that precedes it in the work's numbering, known by the label its witnesses give it. Only segments between the first and the last that the edition prints are reported, so that an edition of one book says nothing of the others.
- The order of whole segments is the exception, and is compared outside the aligner, since a block that has moved far is found most surely by its segments. Segments that a witness has in another order than the edition are a variant over those segments: the smallest stretch of the edition's segments that holds the block and the place the witness has it. Its readings are the segments in each order. A witness is compared over the segments of the stretch that it has, and with fewer than two of them it is not there. A block standing far from its place (a stretch of more than eight segments) is given by the segment it follows.

**Addition.** Words that the edition does not print and some witnesses have are, in the editor's judgement, an addition in those witnesses: had the editor held them to belong to the text, the edition would print them. So are words the edition prints as deleted, in every witness that reads them as the edition does. The variant says so. This is derived from the edition's text and needs no mark of the editor's. The word is the same whether the words came in by design or by a slip, and says nothing of their worth (section 1). A word that a witness has in another spot nearby is no addition where it stands. Nothing of the kind is said of an absence, which a loss that no one marked would explain as well.

**How a variant is reported.** In English, in words written out, with the sigla. A variant is a list:

- first the witnesses that are there, a group under its siglum with its members beside it;
- then one row for each reading, with the witnesses that have it: the edition's reading first, set apart by its weight and not by a label, then the readings of the other witnesses, then the readings that are only reported, with the source of the report, and the conjectures, each with its proposer and its references. A reported reading that a row already gives joins that row.

A row's reading is the words themselves. Where a witness has none, the row says "not in". Where the words are the same in another order, the rows are the words in each order, and no word for a transposition is needed; for whole segments they are the segments' labels in each order. Every witness that is there is named in a row, and nothing stands for "the others". What the edition's reading rests on besides witnesses stands in its row: the proposer of an adopted conjecture with what it did (conjecture, delete, lacuna), a witness whose reading is only reported with the source of the report, and "the editor" where the reading is the editor's own; where the edition has no words and every witness that is there has some, the row reads "not in the edition". Where a witness has a word in another spot nearby, that witness's row in each of the two variants leads to the other. A reading can be shown in the text itself, as the line reads with it.

A note on the edition's words at a variant is shown with the variant, with its references, so that every variant and any of its readings can have its discussion and its bibliography. Conjectures and reported readings carry their own.

**Groups.** The conspectus holds groups: a siglum for at least two of its witnesses (a family, or the agreement of two manuscripts), with a note if wanted ("consensus codicum Vp2H"), under a siglum that no witness, state or other group has. Where all the members have a reading they are listed under the group's siglum, which gathers them and does not hide them. A group follows its members through every change of the conspectus: a member whose siglum changes is renamed in it, a witness that leaves the conspectus leaves its groups, and a group left with fewer than two members goes.

**The editor's word on a variant.** The editor may give a variant a kind over what its letters say (section 3.6), and may mark it **minor**. A minor variant is in the edition's data and its TEI, marked as minor, and is shown to a reader who asks for the minor variants; otherwise the reader's page neither marks nor lists it, and the print apparatus leaves it out. No variant is withheld from readers altogether. Marking a variant minor is a judgement on it, so it is no longer among the variants left to review. The kind and the grade are separate words; a variant that only a conjecture opens can be given either like any other, and both are archived as data. The reader chooses likewise whether the interpretative variants are marked and listed; they are shown to begin with, whatever the edition holds.

**The print apparatus** is a rendition of the variants in the conventions of printed editions: lemma and sigla in a positive or a negative form, a group's siglum in place of its members, a word for the other witnesses (cett., rell.) and for all of them (codd.), a long lemma abridged to its first and last word. What it says of a reading it says in English words, as the screen does (not in, added, deleted, conjectured, supplied, transposed), and an edition has no setting for Latin abbreviations. The plain text among an archive's files gives it. A variant across a boundary stands once, under the segment it begins in, labelled by both; a segment the edition does not print is given as words added, under that segment's label. It says nothing of a loss or of the order of segments. **It is not offered in the interface.** A printed edition is work for later, and until it is taken up no setting of an edition or of the reader concerns the print apparatus, the reader's page shows and prints the text without it, and the plain text with apparatus is not among the downloads. It is kept as built and is not developed. Nothing on screen is derived from it, and none of its devices is a rule for the screen.

**What a page is given of an edition.** No page needs the whole edition collated before it opens. A page asks by segments and is given passages: a segment collated with others comes with the first of them, which holds the variants of them all. The collation of a segment is large (every witness's words at every variant), the variants themselves are small, and what each surface does with them differs.

- The **editor** opens with the text, the apparatus of the first segments, and the order statements. It asks for the apparatus of the segments around the caret as the caret reaches them (a stretch each way, so that moving on does not ask again at once), and, once open, for the **outline** of the whole text: for each segment, the variants that show (their words, review key and whether they need attention) and the words that have drifted. The outline marks the words, counts the variants still to review and steps from one variant to the next, which the editor does over the whole text; a variant in a segment not yet given is found by asking for that segment first. What an edit touches is asked for again and the outline of those segments made again from it.
- The **reader** is sent the whole text and, for each segment, its variants with their readings, the texts that have each named by their position in one list of the page's texts, and what is attached. It marks the variants in the text and opens one from that. It is not sent the words each text has at each variant, nor how each text lines up with the edition; those come, for the segments in view, when a panel needs to light a witness's words. A reader does not wait for the whole text to be collated either: of the segments the cache lacks a hundred are collated alone, those nearest the one the visitor came to, with the passages they settle; the rest are named (with any segment whose passage cannot be told before a neighbour is known), and the page asks for their variants as it opens and sets them in the text as they come (so that for a visitor without scripts, or one who prints at once, those segments lack their variants until the cache is filled).
- A **published version** is fixed, and every one of these is asked for at the version the visitor sees, with what the visitor may see.

### 3.11 People, ownership, visibility

**Accounts and persons are distinct.** Every account is a person under the same id; a person may have an ORCID and need not have an account here. Authorship (changesets, moments, notes) points at persons. Ownership and permissions stay with accounts.

**The shared registry**: works, witnesses, reference schemes, the bibliography. Anyone signed in may create an entry; search before creation and typed identifiers make duplicates visible; duplicates are merged, by administrators or by someone who maintains both entries, and the merged id keeps resolving. Each entry has maintainers. Using an entry needs no permission. A registry entry is not deleted while another user's work depends on it, and a witness is deleted from its own page, where the menu says why when it cannot be.

**Owned records**: transcripts, conjectures, reported readings, editions. The edition is the project: its owner invites collaborators, and the grant reaches the owner's transcripts in its conspectus and the owner's conjecture records on the work. Site roles: member, editor (may edit anything; may not delete, publish, grant or merge), administrator.

**Visibility.** The registry is public: every work and witness is seen and listed by everyone, and none is private. What a page of the registry lists or counts of a work's or a witness's records is what the viewer may see of them, so that another person's draft leaves no trace there. **Only a transcript and an edition are drafts until published.** A conjecture and a reported reading have an owner, who may change and delete them, and are public from the moment they are entered, like the entries of the registry: they are statements about the work, a scholar's proposal or a witness's reading on someone's word, which another editor must be able to find before entering them again. They are a commons any edition may adopt. A conjecture entered in an edition's editor belongs to the edition's owner and remembers the edition and the words it was made on; that link, and which conjectures a draft edition has adopted, are part of the draft, and are told to nobody who may not see the edition. What an editor wants to keep back until the edition appears stays in the draft edition: an emendation typed into its text is the edition's own reading and needs no record, and a remark is a note of the edition. Publishing an edition publishes the owner's transcripts in its conspectus, and is refused while the conspectus names another person's unpublished transcript.

**A published version is fixed.** It records the conspectus, the version of every transcript it compares, and the editors' word on the variants (their kinds, and which are minor), and collates against exactly those. Correcting a witness or changing a mark later changes the draft's apparatus, never a published one. Of the work's conjectures and reported readings a published version has those entered before it was published, so that what others enter later changes nothing in it.

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

The TEI follows TEI P5 as closely as the model allows, and the model has a standard counterpart at each point. A segment is an address and no container (section 3.10), which is TEI's milestone: in a transcript's TEI and in an edition's alike a segment begins with `<milestone unit="segment">` and encloses nothing, and the header declares by TEI's milestone method that the text is cited so. A line begins with `<lb>`. A break or a segment start inside a word says that it does not end the word (`break="no"`), so that a divided word is one word in the TEI as in the stream, each part in its segment.

An edition's TEI is its text in one block in its own order, with the apparatus by parallel segmentation. Every variant is one `<app>` where its words stand, whatever boundaries it crosses, and its lemma is written as the text outside a variant is, with the breaks and segment starts that stand inside it. The one case in which variants overlap nests: the variant of a witness without whole segments stands around the variants inside them, and where another variant lies across one of its ends it is in pieces linked as one, since that a witness has nothing is true of every piece. A reading has the witness's words; where the witness begins a segment is said in its transcript, except for a segment the edition does not print, which begins in the reading. The conjectures and the reported readings stand at their variants, in the reader's file those a reader sees and in the archive's those the archive holds. Who proposed a conjecture and what is stated as the source of a conjecture or a report are listed in the header, and the readings point there, since TEI's `resp` and `source` are pointers; a conjecture of the edition itself points at its editors, and a reported reading names its witness as a witness. The works the edition cites are listed there too, each a structured entry made from its biblatex entry, and a citation that a conjecture or a report makes of one is among the sources its reading points at, with the place cited: the bibliography of a variant is in the file with the variant. A conjecture or report is laid at a variant in one place for the reader, the editor and the files (`attachRecords`), and an adopted conjecture is found by the edition's words that were taken from it.

Every record has an address, `/id/<id>`, which resolves to its page, or as JSON to its archive representation, under the same visibility rules as the pages.

### 3.14 Packages, import and sync

One **package** format serves every scope (a work, an edition, a transcript, a set, an installation): a BagIt zip with RO-Crate metadata around the archive layout. A partial package carries what it depends on at the versions it needs.

**Import** reads packages, bare archives and both format versions, in one transaction; its preview is the same import rolled back. Registry records are matched by id, then through recorded merges, then by a canonical identifier. Persons are matched by id, then ORCID. An import over the web by someone who is not an administrator is **restricted**: it changes only what that account may change, brings new transcripts and editions in as the account's drafts and new conjectures and reported readings in as the account's own, public like any other, and never publishes, moves ownership or grants. The command line imports as the operator.

**Sync between installations is explicit**: a maintainer pulls a work from another installation, or pushes with a token, and reads the report. There is no live replication. Licence compatibility is checked before anything is written.

### 3.15 Licences, terms, rights

- The application is AGPL-3.0-or-later; `packages/core` is Apache-2.0; the specification is CC BY 4.0 and its schemas, ODD and RelaxNG are BSD-2-Clause. The footer links the source of the running version.
- Scholarly records carry the installation's data licence (`DATA_LICENCE`; CC BY-SA 4.0 by default), fixed on a record at its first publication. Registry entries are CC0.
- **Terms of contribution** ([terms.md](terms.md)) are versioned, accepted at registration and again when they change. Until an account accepts the current version it reads and changes nothing.
- An image is copied into archives and packages only when its rights statement allows copying; otherwise only its source address travels.

### 3.16 The dictionaries

The Greek forms and the two dictionaries are not part of Varians. They are built once from their sources and travel as one file that installations import ([lexicon.md](lexicon.md)). Neither the sources nor the built file is in the repository.

## 4. The interface

- **Written for scholars of textual criticism.** No lead paragraph under a heading, no hint under a field unless it states a convention of Varians that cannot be inferred (an identifier's form, that a work is public, what a deletion takes with it). Explanations belong in the guide, which every installation serves at `/guide`.
- **Fixed terms**: work, witness, transcript, edition, segment, page, siglum, group, conjecture, variant, reading, diplomatic and normalized, interpretative and minor variants, addition, Staging. A variant is a stretch where the witnesses differ, with its readings. "Text" is never a synonym for a work.
- **Labels** are nouns and short verbs, without example placeholders. Every heading and every label that is a name is in Title Case, as an English title is, its substantial words capitalized: the label of a button, of a menu item, of a tab, of an item of the navigation, of a column, and the name of a field or of an option (Name of Transcript, Note on Rights, No Transcript). What is a sentence or a phrase and no name is in sentence case: a message, a hint, an error, a description, what a window asks, the words beside a checkbox that say what ticking it does (Keep a diplomatic form beside the normalized), the prompt in a search field (Search the works), an option that describes (In the margin at the start of a line). So is a link that stands as text (in a sentence, under a form, in the footer), unless it is a heading. Whether a thing is clicked does not decide its case. A button or menu item that opens a window in which more is asked ends in an ellipsis; one that leads to a page or acts at once has none.
- **A screen is the same whatever the data hold.** A control does not appear, go away or change its look for a reason the user cannot see: an option is there also when there is nothing to choose, and its list is then empty. What a person may not do at all is another matter, and is not shown to them.
- **A screen has what its task needs and no more.** Making an edition asks which witnesses, under which sigla, with which transcripts. How the apparatus cites a witness more finely (its states under sigla of their own, the variants it notes, groups of witnesses under one siglum) is set where the apparatus is worked on, in the editor's Witnesses and Sigla… window, and is not on the page for making an edition, which keeps those things as they are.
- **A field that is wanted only sometimes is behind a checkbox**, and is shown when the box is ticked: starting a transcript from another has a box, and the transcripts to start from are listed only when it is ticked, with no option that means none; the box is the same where there is no transcript to start from, and the list is then empty.
- **One name for an action**, wherever it is offered: Make New Edition, Make New Transcript, Add New Work, Add New Witness. What belongs to the registry is added; what is one's own is made.
- **One search**, in the header.
- **Arranged by the work a scholar does**, not by kinds of data. For a witness: describe it, add its pages and images, transcribe, segment, map. For a work: register it, gather its witnesses, make the edition, publish. The workbench is arranged this way; the other screens are still to follow (section 7).
- **The work is chosen where text is assigned.** The segment window, Number Lines and the import window have one Work field: a select of the works the transcript's text is assigned to, in the order they occur, and of those chosen in the visit; and a box, Choose another work, that opens a search of the registry, ticked from the start where the select has no work to offer. The import window's select has first an option for no work.
- **Making an edition is one page.** Make New Edition opens it, and nothing is asked on another. It has four entries, each under a heading of the same kind: the edition's name; the work; the witnesses; the editors. The work and the witnesses are chosen alike, from the registry's list on the page itself under a search field, one work, and as many witnesses as wanted one after another; only a work or a witness that the registry does not have is added in a window over the page. Each witness chosen has the siglum it goes by in this edition and its transcript, chosen among those there are or made in a window. That window names the witness and no work, as it does wherever a transcript is made: a transcript is of its witness, and has a work only once text is assigned to the work's segments. Only the work and the name are needed, and the rest can wait. Saving makes the edition, and the page stays: it is from then on Edition Settings, where the same things are changed, and under them the preface, the sources and the conventions, with one Save for the whole page, and from which the edition is read and its text edited. Who owns the edition and who edits it with the owner is a section of that page which acts at once, a grant being a record of its own. A work, a witness or a transcript made in a window is saved with its window, being a record of its own.
- **A name leads to reading; what may be done stands beside it.** The name of an edition opens the reader wherever it stands: on a card, in a list, in a search result. Whoever may edit finds Edit beside the name, and a menu there with everything else they may do, deletion last. A record has that one menu, with the same items in the same order, beside its name on its own page and at the end of its row in a list. This holds for every kind of record.
  - **Edit comes first.** On a record's own page, and on the card or row of an edition, it is a button beside the name; in the row of a smaller record (a conjecture, a reported reading, a bibliography entry) it is the first item of the row's menu. An edition has two faces, and so two buttons, Read and Edit: Read is not offered in the reader, nor Edit in the editor. A transcript is read where it is edited, in the workbench, so its name leads there.
  - **The menu has one order for every kind**: the record's settings; publishing and taking back; copying; downloads; merging; deletion. An item is there only for those who may do it, and one that cannot be done now is shown disabled with its reason. Every item works from wherever the menu stands, a list included: what needs a screen of its own is a page the item leads to.
  - **In a list the menu is shown to those who may change the record; on the record's own page to everyone**, with what they may do, which for a reader is copying and the downloads.
  - **One window asks before anything is deleted, removed, published or taken back.** It is named after the action and says what goes with it. Nothing is deleted without it, and the browser's own confirmation is never used. Delete is said of a record that ceases to exist, Remove of what is taken out of a list and exists still (a collaborator, a maintainer, a witness of a conspectus, another installation), Revoke of a token. A refusal to delete names what the person may see and counts the rest, so that another person's draft is named to nobody.
- **The workbench**: above the text, the page chooser with its arrows, the form, Insert and Tools; in the header, the witness and transcript, the buttons for the side of the pane and for showing it, and the transcript's ⋯ menu, which holds what is done to the record and nothing of the tools (importing and numbering lines are under Tools); under a selection, the toolbar with the features, Move to Page…, Segment… and Map. The facsimile stands on the side the editor chooses. The whole text is a read-only view. Words are mapped only in a page's own view. What the browser remembers (the view, the side, the pane's width) is kept in the browser, not in the account.
- **Variants are shown where they stand.** A variant is marked in the text: on its words, by a dotted line; at the point between two words, where the edition has nothing and a witness has words, by a small mark in the space after the word before it (before the first word of a text). In verse, a variant over whole segments is marked in the margin, between the labels and the words: a rule along a segment that some witnesses do not have, a mark between two lines for a segment the edition does not print, a bracket along segments that stand in another order; two such marks over the same lines stand side by side. In prose these are marked in the text like any other variant: on the words, at the point, and for the order of segments on their labels. Kinds of variant may be marked differently, and the reader chooses which are marked. Opening a mark opens the **variant window**, which holds the list of section 3.10; the reader's Variants panel holds the same lists for the lines in view. The editor's band holds the same list, with what an editor does to it: a reading is adopted from its row, a siglum shows its witness beside the text, and the variant carries its kind, minor and the review. The band is in sections by segment: a variant stands in the section of the segment it begins in, and the section of any other segment its words lie in names it. The order of segments has nothing to adopt there, lines being moved in the text. The reader's lists stand in the order of the text; the band keeps a variant lying within another before it. An apparatus at the foot of the text is one way of showing the variants among others, not the form from which the others are made.
- **The edition editor and the reader** show the page a witness's words stand on, whether or not the words are mapped.
- Editor and reader are separate surfaces over one model. The reader is citable to the segment, with a lasting address for every published version, and prints.

## 5. Operations

- **Authorization is on the server**, for every request. Addresses the server is asked to fetch must be public ones, checked at every redirect. Authentication, mail, downloads, imports and record addresses are rate limited.
- **The texts read are kept.** The server keeps the parsed text of the transcriptions and editions it has read, up to three hundred thousand items (about sixty megabytes), and hands it out again while the row it came from is unchanged, known by the transaction that wrote the row's current version. A text is never changed once loaded. Inside a transaction nothing is kept or handed out. Collations are kept likewise, the two thousand last used, each under the hash of its inputs, and the links of the runs of passages last asked for: a collation is a function of what it reads, so that one with the same hash is the same whoever asks.
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
- On screen, the devices by which a printed apparatus saves space: Latin abbreviations, a negative form, a word for the other witnesses, an abridged lemma, a siglum in place of a group's members, a variant withheld from readers.
- A word beside a reading on what it means or how it is formed.
- Words that measure a witness against an original: interpolation, corruption, spurious, inauthentic.
- Calling an absence an omission, and inferring a loss from the length of what is wanting.
- The segment as a unit of collation, a wall that no variant crosses, and the line as a unit of an edition's text: an edition's lines are how a verse paragraph is shown.
- An interface language other than English, though every string is in one place.

## 7. Not built, and known gaps

Designed or wanted, and not there:

- The reporting of variants as sections 3.10 and 4 state it. What is built differs in these ways:
  - The editor's text marks only words and the segments the edition does not print.
  - A reading cannot be shown in the text.
  - A note cannot be added from a variant, only on a selection or a segment.
  - The order of segments as a variant cannot be marked minor or reviewed, and is not in the TEI or the plain text.
  - A segment that a witness has before the first or after the last segment the edition prints is not reported.
- Further ways of reading the variants in the text: the readings of a chosen witness or group shown in the line, chosen witnesses in parallel, the variants filtered by witness, group and kind.
- The arrangement of the witness, work and edition screens along the workflows of section 4.
- Of the name and the menu beside it (section 4): an edition's Publish… and a transcript's Delete Transcript… are not shown disabled with their reason, and in a list neither is Delete Work… or Delete Witness…, the refusal coming in the window; the offers of ownership, an administrator's change of a role and the witnesses of a conspectus are acted on by buttons of their own.
- Dissemination: DTS, IIIF Presentation manifests with word annotations, a CollateX export.
- An interface for alignment constraints, and for splitting and merging variants.
- Thinning of old history (the core has the function; nothing applies it).
- Comments on other people's records; typeset PDF export (the reader prints through the browser); virtualized long lists; re-encoding of uploads.
- Showing a transcript in Leiden sigla and typing features with them, and offering the full set of features in the workbench, which today offers a few. The workbench still lets a supplement be marked in a transcript, which the model no longer wants.
- Distinguishing kinds of text in an edition by their styling (the speakers and stage directions of a modern play).

Known gaps in what is built:

- A link between two variants in different passages is found among the passages planned around what a page asks for. At the far edge of that stretch a link may be wanting that the whole text collated at once would give.
- A draft and a published version of an edition share the rows of the cache, so that reading the one after the other collates again.
- The Review tab of an edition's history shows the stored lines of a prose paragraph, where the moments show it run on.
- In the reader, the label of a prose paragraph's first segment is a link to the segment; where the order of segments is marked on it, it opens the variant and is no link.
- Adopting the absence of a whole segment removes the segment from the edition's text, where it then stands as a variant the edition does not print, unless it was the first or the last segment. A segment the edition leaves out cannot yet be printed in brackets.
- Undoing a move of text to another page does not bring back the boxes the move detached.
- The pages endpoint of a witness reads every transcript to count the words on each page, which will be slow for many long transcripts. A count kept with the segment index is the remedy.
- An edition's notes on its words and segments are not in its TEI, nor the note a conjecture or a reported reading carries; the works a note cites are listed, its citation of them is not.
- A transcript's TEI does not say where text of no segment begins after a segment (TEI has `<milestone unit="unnumbered"/>` for it), so the file reads as if the segment went on; the JSON has it. An edition's TEI leaves text of no segment out. The importer does not read `part` on a `<w>`.
- In an edition's TEI a variant at a point between two segments, whose witnesses have words of both, stands once, at the end of the first.
- A merged or deleted work's archive directory stays on disk.
- Client-only packages are runtime dependencies, which enlarges the production install.
- Records published before licences existed have none until published again; images uploaded before rights statements existed stay out of archives until given one.
- A word that the edition and a transcript both divide at the edge of a range copied from the transcript is two words afterwards, to be joined by hand.
- The window for copying text offers every transcript of the conspectus, also one the person may not see, which the server then refuses.
- A published version is not quite fixed in what it shows of conjectures and reported readings. One changed after the version was published shows as changed, and one deleted is gone from it, the records keeping no versions. What the edition has adopted is read as the draft now has it, so that adopting or taking back in the draft of a published edition alters the published version and tells its readers of it. The works cited list those cited by records entered after the version. A record brought in by an import or a sync with an earlier date enters the versions published after that date.
- Language and spelling rules are still a work's: a word is read by the rules of the work its segment belongs to, text not yet assigned by those of the work chosen last in the visit, else of the first work the text is assigned to, else by the general rules, and the reader, the collation and the exports take the language of the work. They are to belong to the text itself, a work and a transcript being free to hold text in more than one language.
- Narrow screens are unchecked.
