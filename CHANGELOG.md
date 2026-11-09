# Changelog

What changed in each release of Varians, for those who run it. The section of a release is the text of its release notes on GitHub, so each section begins with a heading `## <version>` and ends where the next begins. Versions follow semantic versioning; the data format has versions of its own, in [docs/formats](docs/formats/).

## Unreleased

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
