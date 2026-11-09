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
- Migration 0012 adds the table `email_tokens` and counts the addresses of existing accounts as confirmed.

### Licences

- The application is licensed under the GNU Affero General Public License, version 3 or later; `packages/core` under the Apache License 2.0; the format specification under CC BY 4.0, its schemas under the BSD 2-Clause licence. The page Sources and licences names them.
