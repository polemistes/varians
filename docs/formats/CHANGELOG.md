# Changes to the Varians Data Format

## Version 2 (2026)

The format becomes a specification ([specification.md](specification.md)) with JSON Schemas at stable addresses, a TEI customization (ODD and RelaxNG), an example archive, and a versioning policy. The differences from version 1:

**Breaking**

- Authorship points at persons, not accounts: `history.ndjson`, `moments.json`, notes, collaborators, site reviews, site kinds and review positions name `personId`; `userId` and `userName` are gone from them. The new `persons.json` lists every person the files refer to, with their ORCID where known.
- Every JSON file is an object whose first member is `$schema`, the `$id` of its schema. The files that were arrays become objects with a named list: `conjectures.json` (`conjectures`), `reported-readings.json` (`readings`), `bibliography.json` (`items`), `citations.json` (`citations`), `pages.json` (`pages`), `zones.json` (`zones`), `memory.json` (`entries`), `moments.json` (`moments`).
- Changesets name their parent (`parentId`) and, for a merge, what they bring in (`merged`); `version` is the installation's local order and may be null for a changeset kept but not applied.
- The free-text `licence` of transcriptions and editions becomes `rightsNote`; `licence` is now an SPDX identifier fixed at publication.
- Edition `adoptions` are objects `{ conjectureId, at }`, not bare ids.

**Added**

- `alignment.json` and `reviews.json` in edition directories, `reviews.json` in transcription directories where someone has a review position.
- Creation times on every record; the maintainers of works and witnesses with their dates; who set a site kind and when; moments with their basis.
- `identifiers` on works and witnesses (typed: CTS URN, Diktyon, Trismegistos, Wikidata, VIAF, URL).
- `urn` in `segments.tsv`, and the CTS URN of each segment on the edition TEI's `<ab>`.
- `head` on transcriptions and editions.
- Rights per image (`rights`, `attribution`, `source` in `pages.json`), image defaults on witnesses, and `LICENSE.md` at the archive's root; images whose rights do not allow copying are not copied.
- `licence` in `work.json` for the records without one of their own.
- In TEI: `<listPrefixDef>` resolving `tok:`, `seg:`, `wit:`, `conj:` and `person:` to the installation's `/id/` addresses; every edition word as `<w>` with `corresp` or `source`; `<availability><licence>`; `<respStmt>` with ORCID.
- Packages: BagIt with RO-Crate 1.2 metadata.

**Added, November 2026**

- In the TEI: `<num>`, `<foreign>`, `<q>`, `<g>` for a sign that is not a letter, `<ex>` in the `<expan>` of a symbol, `<desc>` in a `<gap>`, and `<milestone unit="undefined" rend>` for a paragraphos, a rule or a coronis, as EpiDoc writes them. In the stream: the mark kinds `num`, `foreign` and `q`, `symbol` on an abbreviation, `cert` on a mark or object, `desc` on a gap, and mark objects named by `g`.
- A gap that touches the letters of a word is a point mark of that word.
- In an edition's `conventions`: `groups`, sigla that stand for several witnesses of the conspectus together (`[ { siglum, members, note } ]`), `rest`, the word the apparatus prints for the other witnesses (Varians offers `cett.` and `rell.`), and `all`, the word for all the witnesses (Varians offers `codd.`). Both are absent where the apparatus names every witness.

- A place of variation can be marked minor. An entry of an edition's `siteKinds` is `{ segmentId, siteKey, kind?, minor?, personId, setAt }`: `kind` (`textual` or `interpretative`) when the editor set one, `minor: true` when the place is minor, the two independent. The TEI writes a minor place as `<app type="textual" subtype="minor">` or `<app type="interpretative" subtype="minor">`; the ODD and `varians.rng` allow `app/@type` `textual` and `app/@subtype` `minor`. An archive written on 10 November 2026 may give `kind: "unreported"`, which a reader takes as `minor: true`. The `basis` of a published moment of an edition records the marks as they stood (`siteKinds`, with the same two words), so that a published version does not change when they do.

- A paragraph break of an edition's text may carry `lineation`, `verse` or `prose`: the kind of the paragraph it opens, which where absent is the kind the edition's `conventions.lineation` gives. The line breaks of a prose paragraph are kept and not shown. In the edition's TEI the second `<lb>` of a paragraph break is typed `verse` or `prose`, and the ODD allows `lb/@type` those two values.
- `joinNext` joins a word that a segment boundary divides as well as one that a line break divides, and in an edition a word divided by a line break is kept divided. Nothing in the files changes: the hyphen was never stored.

**Changed, November 2026**

Varians has no users but its maker yet, and the TEI of an edition is changed within version 2 to follow TEI more closely; the JSON files are as they were.

- An edition's text is one `<ab>` in which a segment begins with `<milestone unit="segment" n="…">`, as in a transcription, and no longer an `<ab n="…">` for each segment: a segment is an address and encloses nothing. The milestone has the `xml:id="seg-…"` and the `corresp` that the `<ab>` had. A word that a segment boundary divides is thereby one word in the TEI too.
- A segment start or a line break inside a word has `break="no"`, in a transcription and in an edition (an edition wrote a bare `<lb/>` there), and each `<w>` of a word in several tokens has `part` (`I`, `M`, `F`). The importer reads a segment start with `break="no"` as dividing a word.
- Every variant of an edition is one `<app>` where its words stand, with the breaks and segment starts between its words inside its `<lem>`. For a day a variant across segments was written in parts linked by `prev` and `next`; that is gone. Only the variant of a witness without whole segments may be in pieces so linked, where another variant lies across one of its ends, and it now stands around the variants inside those segments, which were lost from the file before.
- A variant at a point at the end of a segment stands before the break that ends the line, and a segment the edition does not print stands between the segments around it, its reading begun by its own milestone, which gives its label.
- The header has `<refsDecl><refState unit="segment"/></refsDecl>`, and in an edition `<variantEncoding method="parallel-segmentation" location="internal"/>`; the ODD and `varians.rng` have the three elements.
- The archive's `edition.tei.xml`, `edition.txt` and `edition.md` have the conjectures and the reported readings the archive holds, as the reader's downloads have those a reader sees; before, they had none.
- In an edition's TEI `resp` and `source` on a reading are pointers, as TEI defines them, where they held a name and a statement as text. The header's `<sourceDesc>` has a `<listBibl>` of the scholars who proposed the conjectures (`<bibl><author xml:id="resp-…">`) and of the sources stated for conjectures and reported readings (`<bibl xml:id="src-…">`); a conjecture points at its proposer by `resp`, or at the edition's `<editor xml:id="editor-…">` elements where it is the edition's own, and a conjecture or a report at its source by `source`, a conjecture in the archive at its record besides (`conj:<id>`). A reading reported for a witness names the witness in `wit`, and a witness known only by such a reading is listed in `<listWit>`. The ODD and `varians.rng` have `listBibl` and `author`.

**Clarified, November 2026**

- Reconciling two histories (5.3): a merge is also a conflict when it would carry a word into a segment that neither side gave it, which operations on disjoint ids can do. Nothing in the files changes.

## Version 1 (October 2026)

The first archive layout, described in the README of each archive.
