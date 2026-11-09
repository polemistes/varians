# Changelog

What changed in each release of Varians, for those who run it. The section of a release is the text of its release notes on GitHub, so each section begins with a heading `## <version>` and ends where the next begins. Versions follow semantic versioning; the data format has versions of its own, in [docs/formats](docs/formats/).

## Unreleased

### For operators

- **The dictionaries come as one file.** `varians lexicon` imports the lexicon published for the release (29 MB, checked against its SHA-256); `varians lexicon import FILE|URL [--sha256 HEX]` loads one exported elsewhere, `varians lexicon export FILE` writes the loaded one, and `varians lexicon build` builds it from its sources, the LSJ and the Middle Liddell of the Perseus Digital Library, the Ancient Greek Dependency Treebank and the analyses of Morpheus, downloading what it lacks from pinned commits. There is no `lexicon.sqlite` any more, and the command no longer takes a path or address of its own. [docs/lexicon.md](docs/lexicon.md) and [docs/install.md](docs/install.md) describe it.
- A dictionary lemma is now found whatever its case, so a proper name opens its entry directly.
- **Once after updating, run `varians cli conform-pages`** (after the usual backup) and keep what it prints. It puts every transcript's page breaks in the shape the workbench now expects: each names a page of the witness, once, in the order of the pages, without a label; the text of a page break that names no page goes to the text on no page. It prints one line for each transcript it changed, as a change in that transcript's history with the message "Pages reorganized", and nothing on a second run. There is no migration; the collation caches recompute by themselves.

### For editors

- **Pages hold their text.** In the workbench each page of the witness has its own text, typed on that page; there are no page breaks to make. Text on no page has a place of its own, **Not on a page**, where imports without pages land; **Move to 12r** in the toolbar under a selection puts text on its page, proposing the page the facsimile shows, and cut and paste moves words with their features and segments. **Whole text** shows everything, read only, a page under each label.
- **Removing a page never deletes text**: its text goes to Not on a page in every transcript of the witness, and the dialog says how many words that is. Moving a page moves its text with it.
- **Segments are independent of pages**: moving text never changes a word's segment, and a page's first line shows in grey the segment it continues.
- **The workbench is arranged for transcribing**: the page, the form, Insert and Tools above the text, the whole-transcript actions in the header, **Segment…** in the selection toolbar, and **Facsimile on the Left** in the ⋯ menu. A transcript opens on the page last shown, and a witness with neither pages nor text opens on its pages.
- **Imports land where they belong**: a TEI file's pages go to the pages of the witness that have their labels, and the rest of the text to Not on a page or to the page shown, as chosen.
- **The apparatus names what a witness lacks**: a passage missing from a witness within the stretch its transcript covers is printed as "om. B" (or "deest in B" where the transcript marks a gap there) in a place of its own beside the passage's other variants, its lemma the first and last words for a passage longer than three.
- **The edition editor and the reader show the page where a witness's words stand**, whether the words are mapped to the image or not; arrows in the editor browse the witness's pages.
- **A witness is deleted from its own page** (⋯, **Delete Witness…**), where the menu says why when it cannot be.

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
