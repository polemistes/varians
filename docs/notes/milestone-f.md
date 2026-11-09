# Milestone F (installation and releases) and D1 (the licences of the code): notes for PLAN-2 section 13

Built on 9 November 2026 by Claude Opus 5.5 in a worktree, for the lead to merge. What was decided where the plan is silent, what was added, and what the owner must do.

## Decided while building

### Licences (D1, F1)

- The full licence texts come from Arch's SPDX copies in `/usr/share/licenses/spdx` (AGPL-3.0-or-later, Apache-2.0, CC-BY-4.0), which have their paragraphs reflowed; GitHub's licence detection normalizes whitespace. The BSD 2-Clause text is written out; its copyright line reads "the authors of Varians", so that no personal name is added to the repository.
- `LICENSE` (AGPL-3.0-or-later) at the root and, as copies, in `apps/web` and `packages/db`, so that the deployed application and the db package carry their licence; `packages/core/LICENSE` is Apache-2.0; `docs/formats/LICENSE` holds a preamble saying which part is under which licence, then CC BY 4.0 (part A) and BSD-2-Clause (part B).
- Every package.json has `license` and `repository` (with `directory`); the versions are 0.2.0.
- `SECURITY.md`: GitHub's private vulnerability reporting on polemistes/varians, no address. Supported: the newest release only.
- The page Sources and licences opens with a section "Varians" (application, domain package, data format), then "Data and resources" as before.

### Versions (F7)

- The version string is `0.2.0+1a2b3c4`: the package version with the short commit as semantic versioning's build metadata; the commit alone if it is not 7 to 40 hexadecimal digits is dropped.
- The commit is fixed at build by Vite `define` (`apps/web/build-info.ts`): from `VARIANS_COMMIT` (CI, the Dockerfile, release.sh), else `git rev-parse`, else unknown.
- The footer shows "Varians <version>" and a link "Source code" to `https://github.com/polemistes/varians/tree/<commit>`. A new optional setting `SOURCE_URL` replaces the link for an installation that runs a changed Varians (AGPL section 13 asks them to offer their own source). Only http(s) values are accepted.
- `GET /api/version`: `{ version, release, commit, source }`. `GET /health`: `{ status, version, database }`, 200 when the database is level with the release or ahead of it, 503 when behind or unreachable (3 s timeout), never cached, no error text. "Level" is drizzle's own test: the newest `created_at` in `drizzle.__drizzle_migrations` against the newest `when` of the journal (exported by `@varians/db` as `@varians/db/journal`).

### The build

- Building no longer needs `DATABASE_URL`: `lib/server/db.ts` uses a placeholder while `building` (the pool connects only at the first query). The Docker build relies on this.
- The command-line scripts are bundled by `apps/web/vite.scripts.config.ts` into `build/scripts/{cli,import-lexicon,migrate}.js` after the SvelteKit build (`"build": "vite build && vite build -c vite.scripts.config.ts"`). Reason: Node strips TypeScript types only outside `node_modules`, so a production install could not run the scripts from source without tsx; tsx stays a development dependency. In development `pnpm --filter @varians/web cli` still runs from source.
- `apps/web/package.json` has `"files": ["build", "LICENSE"]`, so that `pnpm deploy` ships `build/` (which `.gitignore` would otherwise exclude). `packages/db` has `"files": ["src", "drizzle", "LICENSE"]`.
- `apps/web/scripts/migrate.ts` applies the migrations; it finds them beside `@varians/db`'s `src/` through `import.meta.resolve`, or in `MIGRATIONS_DIR`.
- `apps/web/scripts/env.ts` loads settings for the scripts: the environment, then `VARIANS_ENV_FILE`, then `apps/web/.env`, with double or single quotes.
- Fixed on the way: `cli make-admin` (and every `--user`) looked the address up case-sensitively against addresses stored as typed, so `make-admin` failed for an account registered with capitals. It now compares `lower(email)`, as login does.

### bin/varians (F3)

- POSIX sh (Alpine has no bash). Works from a release (`app/` beside `bin/`) and from a checkout (`apps/web`). Commands: `serve` (migrate, then `exec node build/index.js`), `migrate`, `backup [DIR]`, `restore DIR [--yes]`, `cli ...`, `lexicon PATH|URL [--sha256 HEX]`, `version`, `help`.
- Settings: the environment; when `DATABASE_URL` is unset, the file `VARIANS_ENV_FILE` names, else `/etc/varians/varians.env` if readable. The file is sourced as shell, so values with spaces or `< >` are quoted (the examples do so; Compose and systemd accept the quotes).
- It exports `VARIANS_FORMATS_DIR=<release>/docs/formats` when unset, so that the archive writer and `/formats` find the specification in any layout.
- `backup`: `varians.dump` (pg_dump custom format, no owner, no privileges), `storage.tar.gz`, `backup.txt` (version, time); files mode 600; written as `.part` and renamed. Without a directory: `BACKUP_DIR/<UTC time>`, and the newest `BACKUP_KEEP` (default 14, 0 keeps all) are kept; only directories named by the time stamp and holding `backup.txt` are ever deleted.
- `restore`: refuses without `--yes` when not on a terminal (asks for "yes" on one); checks the dump with `pg_restore --list`; refuses a storage tarball with absolute names, `..` or links; unpacks the storage to a staging directory first; replaces the database in one transaction (drop the `drizzle` and `public` schemas, recreate `public`, the dump as SQL) whose `commit` is sent only after `pg_restore` has succeeded, so a failure leaves the database as it was; only then swaps the storage; then migrates. Also reads the backups of `deploy/backup.sh` (a `storage/` directory). Tested here: a full round trip, a refused truncated dump, a pg_restore failing half-way (database and storage unchanged), and the refused tarballs.

### The image and Compose (F2, F3)

- `node:24-alpine`: sharp 0.35.5 and @node-rs/argon2 2.2.1 publish musl builds for x64 and arm64 (they are in the lockfile). pnpm is installed with `npm install -g pnpm@11.26.0`. Runtime packages: git, tini, GNU tar, `postgresql${PG_MAJOR}-client` with `PG_MAJOR=18`.
- The image holds the same layout as the tarball under `/opt/varians` (`app/`, `bin/`, `docs/`, licence files), runs as the image's user `node`, has `STORAGE_DIR=/data/storage`, `BACKUP_DIR=/data/backups`, `VARIANS_FORMATS_DIR=/opt/varians/docs/formats`, `PATH` with `/opt/varians/bin` (so `docker compose exec varians varians backup` works), a health check by `node -e fetch(.../health)`, and `ENTRYPOINT tini -- bin/varians`, `CMD serve`.
- `compose.yaml` adds to the plan a named volume for `/data/backups`, `VARIANS_VERSION` (image tag, default latest) and `VARIANS_PORT`. The database volume is mounted at `/var/lib/postgresql`, as PostgreSQL 18's image expects. `DATABASE_URL` is composed from `POSTGRES_PASSWORD`, which must therefore be letters and digits. The database publishes no port.
- `.env.example` at the root has the plan's settings plus `ADDRESS_HEADER`/`XFF_DEPTH` (Caddy adds X-Forwarded-For) and the optional ones.
- `Caddyfile`: `{$DOMAIN}`, compression, `reverse_proxy varians:3000`.

### The native release (F4)

- Layout: `/opt/varians/releases/varians-<version>-linux-<arch>/`, link `/opt/varians/current`, settings `/etc/varians/varians.env` (root:varians 640), data in `/var/lib/varians/{storage,backups}` made by systemd's `StateDirectory`. The system user's home is `/var/lib/varians`.
- The units for it are new files in `deploy/native/` (`varians.service`, `varians-backup.service`, `varians-backup.timer`, `varians.env.example`); `deploy/systemd/` stays as it is for varians.eu, so that `push.sh`, `deploy.sh` and the installed unit there are untouched. systemd accepts only absolute paths, so the units name `/opt/varians/current` and `/etc/varians/varians.env` rather than paths relative to the release; docs/install.md says so and how to change them with `systemctl edit`. The unit adds the usual sandboxing (ProtectSystem=strict, ProtectHome, PrivateDevices and so on).
- nginx: `deploy/nginx/varians.conf`. Apache: the existing varians.eu files, with the instruction to replace the domain.
- `deploy/release.sh [OUT]` builds `varians-<version>-linux-<arch>.tar.gz` and its `.sha256` for the machine it runs on (x64 or arm64, glibc); the tarball holds `app/`, `bin/`, `deploy/` (without `host` and `LOCAL.md`), `docs/`, the licence files and a `VERSION` file. Tested here: built, unpacked elsewhere, migrated a fresh database and served `/health` from it.

### CI (F5)

- `.github/workflows/ci.yml`, on every push and pull request: job `test` (frozen install, `pnpm check`, core tests, migrations, web tests against a `postgres:18-alpine` service on port 54329, the build, the licence check); job `image` (builds the image, starts `compose.yaml` with it, waits for `/health`, makes a backup, restores it with the service stopped, checks `/health` again).
- `.github/workflows/e2e.yml`: Playwright nightly (02:17 UTC) and on demand; writes `apps/web/.env.test`; uploads the report on failure.
- `.github/workflows/release.yml`, on tags `v*`: checks that the tag equals `apps/web/package.json`'s version and that CHANGELOG.md has its section; the image for linux/amd64 and linux/arm64 to `ghcr.io/polemistes/varians` with tags `<version>`, `<major>.<minor>` and `latest` (not for pre-releases); the tarballs on `ubuntu-24.04` and `ubuntu-24.04-arm`; the GitHub release with the tarballs and the notes from `deploy/release-notes.sh <version>`.
- Actions are referenced by major tag (`actions/checkout@v5` and so on), not by commit hash; pinning them to hashes is a later hardening the owner may want.
- The licence check is `apps/web/scripts/check-licences.ts`: it parses SPDX expressions (OR, AND, WITH, parentheses) and allows a fixed list of AGPL-compatible licences (0BSD, AGPL-3.0-or-later, Apache-2.0, Artistic-2.0, BlueOak-1.0.0, BSD-2/3-Clause, CC-BY-4.0, CC0-1.0, GPL-3.0-or-later, ISC, LGPL-2.1-or-later, LGPL-3.0-only/-or-later, MIT, MIT-0, MPL-2.0, Python-2.0, Unlicense, WTFPL, Zlib) and the exceptions LLVM-exception and Classpath-exception-2.0; anything else, and anything unknown, fails, unless the package is named in `PACKAGE_EXCEPTIONS` with a reason (empty now). Today: 190 production dependencies, all allowed (MIT 162, Apache-2.0 9, ISC 7, BSD-3-Clause 6, MPL-2.0 2 (lightningcss), and one each of LGPL-3.0-or-later (libvips, through sharp), MIT-0 (nodemailer), BSD-2-Clause, 0BSD).
- `CHANGELOG.md` with sections `## <version>`; a section `## Unreleased` on top for the next.

### Mail (F6)

- Table `email_tokens` (id = SHA-256 of the token, user, purpose `verify` or `reset`, the address it was made for, expiry, used, created). Transient: it must be classified so in milestone A's table classification.
- Tokens are 32 random bytes in base64url. Lifetimes: confirming an address, a day; a reset asked for by the owner, an hour; a reset sent or made by an administrator (users page or `cli reset-password`), a day. A token is used in one `UPDATE ... RETURNING` (two simultaneous uses: one succeeds); it serves only its purpose; it stops working when the account no longer has the address it was made for; making one retires the account's earlier tokens of that purpose; expired and used tokens older than a week are deleted when a new one is made.
- Mail is on when both `SMTP_URL` and `ORIGIN` are set: links are made from `ORIGIN` only, never from the request's Host header (which would let anyone send an account's owner a reset link to another site).
- With mail, an account cannot log in until its address is confirmed. Migration 0012 marks the addresses of all existing accounts confirmed (`email_verified_at = created_at`), so that turning mail on locks no one out; an account made later while there was no mail is asked to confirm at its first login after mail is turned on (logging in with the right password sends a new link, at most three messages an hour per address). `cli confirm-email <email>` confirms by hand.
- Opening a confirmation link confirms the address and signs no one in (a mail scanner that opens links gains nothing). Opening a reset link only checks it; the link is used when the new password is set, which marks the address confirmed, ends every session of the account, retires its other reset links, and signs the browser in.
- A request for a new password is answered at once and identically whether or not the account exists; the lookup and the sending run after the answer. Limits: 20 requests an hour per visitor address (`resetByAddress`), 3 messages an hour per address mailed (`mailByAccount`, silently: the answer stays the same), and setting a password counts against `loginByAddress`. A password reset hashes the new password only for a usable link (argon2 is deliberately slow).
- A password change on the account page now also retires outstanding reset links.
- The users page gains a column "Password" with **Send reset link** (with mail) or **Make reset link** (without: the link is shown to the administrator, valid a day, to pass on). Administrators can thereby obtain a link for any account when there is no mail, as they can with the command line; administrators already have every other power.
- The messages are plain text, signed with `SITE_NAME` and `ORIGIN`, and do not name the account holder: the name is chosen by whoever registers, possibly with someone else's address. `MAIL_FROM` defaults to `<SITE_NAME> <noreply@host of ORIGIN>`; subjects and recipients with line breaks are refused.
- `SITE_NAME` is read in `lib/server/mail.ts` (`siteName()`); milestone D2 defines the setting, so the lead should make both use one helper when merging.

### Operators' guide and the dictionaries (F8)

- `docs/install.md`: requirements, Compose, native, proxies, a table of every setting, mail, the first account, backups and restore, upgrading and going back, `/health`, the dictionaries, where the data is, the source-code offer. README gains "Installing" and "Licences"; deploy/README.md says it describes varians.eu's own deployment.
- `lexicon:import` (and `varians lexicon`) takes a path or an http(s) address, downloads to a temporary file, and checks `--sha256` when given; without a checksum it accepts only https, and refuses a redirect that leaves https. docs/install.md says the file's public home is still to be decided by the owner (Open 4).
- docs/guide.md gains a short section "Your account" (confirmation, forgotten password, the version in the footer).

### Security review (F9)

Reviewed: the tokens, the mail flows, `/health` and `/api/version`, backup and restore, the lexicon download, the image and compose file. Fixed in the course of it: links made only from `ORIGIN`; no account names in mail; header line breaks refused; the reset request answered before any lookup; per-address mail limit; argon2 only for usable links and those attempts rate limited; reset links retired by a password change; `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on the link pages; backups mode 600; restore refusing escaping names and links in tarballs; https enforced on lexicon downloads without a checksum. Accepted and documented: a token appears in the proxy's access log for the request that opens it (single use, one hour or one day); sessions of unconfirmed accounts made before mail was turned on stay valid until they expire; `restore` executes the SQL of the dump it is given (restore only your own backups); an administrator without mail can make a reset link for any account. The import upload and the `/id/` resolver named in F9 belong to milestones E and C and are not in this branch.

## Dependencies added

- `nodemailer` 10.4.0, MIT-0 (named in the plan).
- `@types/nodemailer` 8.0.2, MIT, development only.

## Deploy note for the owner

- **Migration**: one, `0012_email_tokens` in this branch (the lead renumbers it at merge, since 0012 is taken on main). It adds `email_tokens` and sets `email_verified_at` for existing accounts; it only adds, but take a backup first as always. **The lead must also make its journal `when` later than every earlier entry's** (drizzle applies only migrations newer than the newest applied; this branch's entry has `when` 1794193870692).
- **Settings**: nothing is required. Optional: `SMTP_URL` and `MAIL_FROM` to send mail (then accounts registered from then on confirm their address; existing ones are confirmed already), `SITE_NAME`, `SOURCE_URL` (only for a changed Varians). varians.eu's `ORIGIN` is already set, which mail needs.
- **varians.eu deploys as before**: `deploy/push.sh`, `deploy.sh`, `backup.sh` and `deploy/systemd/` are unchanged. `pnpm --filter @varians/web build` now also bundles the scripts; `pnpm --filter @varians/web cli ...` works as before, and `bin/varians` works from the release directory too.
- **Without mail on varians.eu**: the page for a forgotten password says to ask the administrator; the users page has **Make reset link**; `sudo -u varians -H pnpm --dir /home/varians/app --filter @varians/web cli reset-password <email>` prints a link (ORIGIN from varians.env).
- **On GitHub, by hand** (once the repository is public): turn on private vulnerability reporting (Settings, Security, "Private vulnerability reporting"), which SECURITY.md promises; after the first release, make the package `varians` on ghcr.io public and link it to the repository (new packages are private); the release workflow uses `ubuntu-24.04-arm` runners, available to public repositories. Releasing is `git tag v0.2.0 && git push origin v0.2.0`; CHANGELOG.md has the 0.2.0 section.

## Not verified here

- Docker is not installed on this machine: the Dockerfile, compose.yaml, the Caddyfile and the image's health check have not been run. The CI job `image` builds and exercises them on the first push. The most likely point of failure is the Alpine package `postgresql18-client`, which I believe is in Alpine from 3.23 on but could not check; if the base image's Alpine lacks it, pin a newer `node:24-alpine3.x` tag.
- The workflows have been parsed and checked for structure, not run.
- The nginx snippet and the native systemd units have not been run (`systemd-analyze verify` finds only the missing `/opt/varians/current`).
- Mail has been tested with nodemailer replaced by a collector, not against an SMTP server.
- Playwright was not run (by instruction). Touched in the interface: the footer, the login page (link to reset), registration (the confirmation notice), the new pages `/reset`, `/reset/<token>`, `/verify/<token>`, the users page (new column and notice), the sources page.
- The production install is about 224 MB, largely because client-side packages (bits-ui and its peers, which pull in @sveltejs/kit, vite and typescript) are runtime dependencies; moving client-only packages to devDependencies would let adapter-node bundle them and shrink the image, but changes the build and was left alone.
