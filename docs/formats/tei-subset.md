# The TEI subset

What Varians reads from and writes to TEI P5 (`packages/core/src/tei/`). Everything in the table has a place in the stream model; elements outside it are read through (their text kept) with a warning, and never written.

## Structure

| TEI | In the stream | Notes |
|---|---|---|
| `<div type subtype n>`, `<div1>`…`<div7>` | an address part `{unit: subtype or type, n}` for segment starts | divs of type `edition`, `translation`, `commentary`, `apparatus`, `transcription`, `notes`, `bibliography` without a subtype are containers and give no part |
| `<l n>` | a line break and a segment start `[…div parts, {line, n}]` | |
| `<lb n break="no" rend>` | a line break; `break="no"` joins the words either side; also a start with unit `lb` (physical line citation) | the mapping dialogue decides which starts to use |
| `<milestone unit n>` | a segment start accumulating the latest `n` per unit (Stephanus page and section) | an earlier unit resets the later ones |
| `<pb n facs>` | a page break and a page (label, image reference) | |
| `<cb n>` | a column break with a label | |
| `<p>`, `<ab>` | a paragraph break | |
| `<lg>`, `<item>`, `<row>` | a line break | |
| `<w>` | one token (punctuation directly after it attached) | two `<w>` with no whitespace between them are one word |
| `<head>`, `<speaker>`, `<stage>`, `<label>`, `<trailer>`, `<fw>`, `<byline>` | a paratext object with `attrs.type` | |

## Features

| TEI | Mark kind | Attributes kept |
|---|---|---|
| `<unclear>` | `unclear` | reason, cert |
| `<supplied reason>` | `supplied` | reason, resp |
| `<del rend>` | `del` | rend, hand |
| `<add place>` | `add` | place, hand |
| `<subst>` | the del and add inside it | |
| `<choice><abbr/><expan/></choice>`, `<expan>…<ex>…</ex></expan>` | `abbr` with `attrs.expan` | `<am>` kept in the form |
| `<choice><sic/><corr/></choice>` | `corr` with `attrs.corr` | the form is the sic |
| `<choice><orig/><reg/></choice>` | the normalized form (`norm`); `<orig>` holds the diplomatic form (`form`) | no mark |
| `<hi rend>` | `hi` | rend |
| `<damage>` | `damage` | agent, degree |
| `<surplus>` | `surplus` | |
| `<handShift new>` | `handShift` on the next token (a point mark inside a word) | new |
| `<seg type="crux">` | `crux` | |
| `<gap reason quantity unit extent>` between words | a gap object | inside a word: a point mark `gap` |
| `<space quantity unit>` | a space object | |
| `<figure><figDesc/></figure>` | a figure object | |
| `<note>` | a note object | |
| `<metamark>` | a mark object | |
| `<app><lem>…</lem><rdg type="margin\|interlinear\|other" hand>…</rdg></app>` | `variant` on every token of the lemma, one `attrs.group` for the span | group (a short id, made anew on import), reading (the rdg's text; empty: the variant leaves the words out), place (the rdg's type), hand |
| any other `<app><lem/><rdg/></app>` on import | the lemma's words only, with a warning | editions are written with `<app>`, see below |

A **correction** is a `del` or `add` mark (TEI `<del>`, `<add>`). Its `attrs.hand` names the hand that made it: a hand of the witness by id, written as `hand="#hand-ID"` pointing at the witness's `handNote`; `scribe` (the main hand, written as its handNote when one is registered, else left unsaid); `other` (an unidentified hand, left unsaid); or a value as imported, written as it came. Its `attrs.seq` is the stage of correction (TEI `@seq`): 1 for the first layer, 2 for the next; corrections without a stage belong to no particular layer. An edition can collate a witness as first written, after all corrections, after a stage, or with the corrections of one hand.

A **variant noted in the carrier** (a reading written in the margin or between the lines, often introduced by γρ., or elsewhere on the page) is the mark `variant` on each token of the words it concerns, all with the same `attrs.group`: `{ kind: 'variant', attrs: { group: 'k3f9', reading: 'ἔννεπε μοι', place: 'margin', hand: 'h2' } }`. It is always a whole-token mark, and a token has at most one. The span is written as one `<app>` whose `<lem>` holds the words as the text has them (with any breaks and marks inside) and whose single `<rdg>` holds the variant; the `<rdg>`'s `type` is the place. An edition may collate the variants as a text of their own under a sub-siglum (`A v.l.`): the words of each span are replaced by the reading, the rest of the witness as corrected.

## Header

`<titleStmt>` title and author; `<profileDesc><langUsage><language ident>` or `xml:lang`; `<sourceDesc><msDesc>`: `msIdentifier` (settlement, repository, idno, altIdentifier type="siglum"), `head` (name), `msContents/summary` (description), `physDesc/objectDesc/supportDesc` (material, extent), `handDesc` with one `handNote` per hand (`xml:id="hand-ID"`, `n` the label, `scope` sole, major or minor; the scribe of the text is sole or major), `history/origin/origDate`.

## Facsimile

Written: `<facsimile><surface xml:id n><graphic url width height/><zone xml:id ulx uly lrx lry|points/></surface></facsimile>`, with `<pb facs="#surface">` and `<w facs="#zone">` linking text to image. Coordinates are scaled to the image size when known, else to 1000. Zones are not read back from TEI yet; the archive's `zones.json` is the authoritative record.

## Editions

`exportEditionTei` writes the critical text with the parallel-segmentation apparatus: `<listWit>` from the conspectus (`<witness xml:id="wit-SIGLUM">`), one `<ab n="label">` per segment, and at every site `<app><lem wit="#wit-A #wit-C">…</lem><rdg wit="#wit-B">…</rdg></app>`; an omission is an empty `<rdg wit/>`, a lacunose witness `<rdg wit><gap reason="lost"/></rdg>`, a conjecture `<rdg type="conjecture" resp="Name" source="…">`, an adopted conjecture `<lem resp="Name">`, a reported reading `<rdg type="reported">`.

## What is not in TEI

Attested separators (`sep`), the `unchecked` flag, edition token sources, segment run parts, review marks and the change history live only in the JSON files of the archive.
