# Changelog

What changed in each release of Varians, for those who run it. The section of a release is the text of its release notes on GitHub, so each section begins with a heading `## <version>` and ends where the next begins. Versions follow semantic versioning; the data format has versions of its own, in [docs/formats](docs/formats/).

## Unreleased

### For operators

- **The dictionaries come as one file.** `varians lexicon` imports the lexicon published for the release (29 MB, checked against its SHA-256); `varians lexicon import FILE|URL [--sha256 HEX]` loads one exported elsewhere, `varians lexicon export FILE` writes the loaded one, and `varians lexicon build` builds it from its sources, the LSJ and the Middle Liddell of the Perseus Digital Library, the Ancient Greek Dependency Treebank and the analyses of Morpheus, downloading what it lacks from pinned commits. There is no `lexicon.sqlite` any more, and the command no longer takes a path or address of its own. [docs/lexicon.md](docs/lexicon.md) and [docs/install.md](docs/install.md) describe it.
- A dictionary lemma is now found whatever its case, so a proper name opens its entry directly.
- **Once after updating, run `varians cli conform-pages`** (after the usual backup) and keep what it prints. It puts every transcript's page breaks in the shape the workbench now expects: each names a page of the witness, once, in the order of the pages, without a label; the text of a page break that names no page goes to the text on no page. It prints one line for each transcript it changed, as a change in that transcript's history with the message "Pages reorganized", and nothing on a second run. There is no migration; the collation caches recompute by themselves.

### For editors

- **Next site and Previous site start from the caret.** With the caret on a word that has no variant, they went to the first or last place of the whole text; they now go to the nearest place from the line the caret is in.
- **A speaker or heading that opens a line is exported with that line.** In the plain text and the TEI of an edition it stood at the end of the line above.
- **The apparatus reports each variant over its own words.** Every witness is now compared with the edition by itself, so the order of the sigla no longer changes the apparatus, and a witness that agrees with the edition is never reported as differing. Variants that stand next to each other are separate entries. A line or stretch that one witness omits or has lost no longer swallows what the others read otherwise inside it: those are entries of their own. A reading in words over a phrase (a transposition, one phrase for another) is one entry that says what every witness has for the phrase. Review marks on places whose extent has changed are gone: those places count as not yet looked at.
- **Pages hold their text.** In the workbench each page of the witness has its own text, typed on that page; there are no page breaks to make. Text on no page has a place of its own, **Not on a page**, where imports without pages land; **Move to 12r** in the toolbar under a selection puts text on its page, proposing the page the facsimile shows, and cut and paste moves words with their features and segments. **Whole text** shows everything, read only, a page under each label.
- **Removing a page never deletes text**: its text goes to Not on a page in every transcript of the witness, and the dialog says how many words that is. Moving a page moves its text with it.
- **Segments are independent of pages**: moving text never changes a word's segment, and a page's first line shows in grey the segment it continues.
- **The workbench is arranged for transcribing**: the page, the form, Insert and Tools above the text, the whole-transcript actions in the header, **Segment…** in the selection toolbar, and **Facsimile on the Left** in the ⋯ menu. A transcript opens on the page last shown, and a witness with neither pages nor text opens on its pages.
- **Imports land where they belong**: a TEI file's pages go to the pages of the witness that have their labels, and the rest of the text to Not on a page or to the page shown, as chosen.
- **An edition with many witnesses opens and saves much sooner.** The editor opens on the first lines and counts the places of variation of the whole text a moment later, and the apparatus of the lines around the caret comes as the caret reaches them; the reader is sent the places of variation of the whole text at once, and the words of each witness at a place when its panels need them; where the apparatus has to be made afresh (after an update that changes how it is collated) the reader opens on the lines nearest the one asked for and takes in the apparatus of the others as it arrives. An edition of thirteen hundred lines and thirty witnesses opens in about a second or less where it took fifteen, a save of one word takes a fraction of what it did, and the apparatus, the plain text and the archive are made in a fraction of the time. Nothing is shown otherwise than before.
- **The apparatus names what a witness lacks**: a passage missing from a witness within the stretch its transcript covers is printed as "om. B" (or "deest in B" where the transcript marks a gap there) in a place of its own beside the passage's other variants, its lemma the first and last words for a passage longer than three.
- **The edition editor and the reader show the page where a witness's words stand**, whether the words are mapped to the image or not; arrows in the editor browse the witness's pages.
- **A witness is deleted from its own page** (⋯, **Delete Witness…**), where the menu says why when it cannot be.
- **Leiden+ comes in and goes out.** The import's Leiden tab reads Leiden+, the notation of papyri.info, with everything it can say of a papyrus, and **Download Leiden+** in the workbench's ⋯ menu writes a transcript in it. TEI and EpiDoc imports read the same things: numbers with their values, glyphs, paragraphoi and rules, words in another language, quotations, symbols with their expansion, what is said of a gap, and the doubt of an editor.
- **The import knows a text to start from from a transcript of the witness.** A text to start from (an earlier edition from the web, plain text) gives its words and their numbering and nothing else: none of its editor's brackets, notes, speakers or headings, and not its pages, which are that edition's; nothing is recorded of where it came from. A transcript of the witness made elsewhere (TEI or EpiDoc, Leiden notation, PAGE or ALTO) is read with its features and its pages, and its source can be recorded. A TEI file may be either, and the import asks which. Until now every TEI import took the file's page breaks for pages of the witness and its editor's marks for features of the witness.
- **A transcript no longer takes in what an editor supplied.** A transcript that is imported leaves out letters restored in square brackets and keeps the gap, which the apparatus reports; a word broken by a gap counts with it. Corrections of the scribe's spelling become normalized forms, to be confirmed. Transcripts imported before are not changed.
- **A scribe's correction of a word is read both ways**: imported as a substitution, it is two words, the one deleted and the one added, so that an edition can collate the witness before and after correction.
- **A transcript keeps the shape of its pages whatever happens meanwhile.** Text typed on a page that someone removed in the meantime, a page begun by two people at once, or the undoing of a page's removal no longer leaves a page break without its page: the save puts the text in order, the status line says so, and the History shows it as _Pages reorganized_.
- **Importing and pulling no longer let a word slip into another segment.** Changes made here and on another installation to different words could together carry a word into a segment neither side gave it (one side moving a word to the head of a line, the other changing the segment that begins before it). Such a text is now reported as changed on both sides, for you to keep yours or take theirs. The same holds where both sides put words at the very start of a text: each installation would have set the other's words first, and the two would have differed for good.

## 0.2.0

The first public release.

### For operators

- Two ways to install: Docker Compose (`compose.yaml`, with Caddy for certificates under the profile `tls`) and a native release tarball with a systemd unit. [docs/install.md](docs/install.md) is the operators' guide.
- `varians` (bin/varians), the operator's command: `serve` applies the migrations and starts the server; `migrate`, `backup`, `restore`, `cli`, `lexicon`, `version`.
- `GET /health` answers with the version and the state of the database, for health checks; `GET /api/version` with the version and the address of its source.
- Mail over SMTP (`SMTP_URL`, `MAIL_FROM`): addresses are confirmed at registration, passwords can be reset by their owner, and administrators can send a link to set a new password. Without mail, registration works as before, and an administrator makes reset links on the users page or with `varians cli reset-password <email>`.
- The footer shows the running version and links its source code.
- `lexicon:import` (`varians lexicon`) accepts an https address as well as a path, and checks a SHA-256 given with `--sha256`.
- Migrations 0012 to 0017 run on start: the archive's queue, persons and the parents of changesets, email tokens (the addresses of existing accounts count as confirmed), licences and rights of records and images, the end of the free-text licence columns (take a backup first), API tokens and remotes.
- New optional settings: `DATA_LICENCE` (CC-BY-SA-4.0 by default), `SITE_NAME`, `SECRET_KEY` (to keep tokens of other installations), `ARCHIVE_WRITE_DELAY_SECONDS`.

### For editors

- **The archive** of a work holds every record, follows every change within a minute, and is committed at every named moment and publication in the name of the person who made it.
- **The Varians Data Format, version 2**, is a specification with JSON Schemas, a TEI customization (ODD and RelaxNG) and an example, served by every installation at `/formats`. The TEI names the witness words each edition word comes from, the passages' CTS URNs, the licence and the people responsible.
- **Persons and ORCID iDs**: the history names people, who may give their ORCID iD on the account page; people from other installations are recorded without an account.
- **Imports never overwrite**: a text changed only on the other side is brought up to date, changes on both sides in different places are merged, and changes in the same words are reported, to keep yours or take theirs.
- **Typed identifiers** of works and witnesses (CTS URN, Diktyon, Trismegistos, Wikidata, VIAF, address), found by search, and **merging** of two works or two witnesses registered twice.
- **Every record has an address**, `/id/<id>`, leading to its page or, asked for JSON, giving the record as the archive holds it.
- **Licences and rights**: a published record carries the installation's data licence, fixed at its first publication; every image has its rights statement and credit line, and only images whose statement allows it are copied into archives and packages; the reader says how to cite an edition. **Terms of contribution** are accepted before editing or publishing.
- **Packages**: works, editions, transcripts and the whole installation download as checked packages (BagIt with RO-Crate metadata); **Import…** previews a package before bringing it in.
- **Other installations**: a work's maintainers compare, pull from and push to its copy on another installation, with tokens made on the account page.

### Licences

- The application is licensed under the GNU Affero General Public License, version 3 or later; `packages/core` under the Apache License 2.0; the format specification under CC BY 4.0, its schemas under the BSD 2-Clause licence. The page Sources and licences names them.
