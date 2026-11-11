# Running Varians: the operators' guide

This guide is for the people who install and look after an installation of Varians. [guide.md](guide.md) is for those who use it. Every release is published at [github.com/polemistes/varians](https://github.com/polemistes/varians/releases), as a container image (`ghcr.io/polemistes/varians`) and as a tarball for Linux on x64 and arm64.

There are two ways to install it. **Docker Compose** is the simpler: one file starts Varians, its database and, if you wish, a web server that obtains the certificate. The **native** installation runs the same release from a tarball under systemd, beside a PostgreSQL and a web server you already have.

## What it needs

- A small server: two cores, two gigabytes of memory, and disk for the images (the uploads are kept as they came, with a tile pyramid beside each; allow a few gigabytes per thousand pages).
- A domain name pointing at the server, and ports 80 and 443 open to it.
- For Docker Compose: Docker Engine with the compose plugin.
- For the native installation: Linux with glibc on x64 or arm64 (Debian, Ubuntu, Fedora, Arch and the like), Node.js 24 or later, PostgreSQL 16 or later (18 is what the image uses), git, tar, and the PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`) of the server's major version, for backups.
- Optionally, an SMTP server through which Varians can send mail.
- For the Greek dictionaries, outbound https to GitHub while `varians lexicon` runs, which downloads the built lexicon (29 MB) once (see _The dictionaries_).

## With Docker Compose

1. Fetch the three files of a release into a directory of their own, here for 0.2.0:

   ```sh
   mkdir varians && cd varians
   for f in compose.yaml Caddyfile .env.example; do
     curl -fsSLO "https://raw.githubusercontent.com/polemistes/varians/v0.2.0/$f"
   done
   cp .env.example .env
   ```

2. Edit `.env`: set `ORIGIN` to the public address of the site, `DOMAIN` to its host name, `POSTGRES_PASSWORD` to a long random string of letters and digits (`openssl rand -hex 24` makes one), and, if you have one, the mail server (see _Mail_). Every setting is described under _Settings_.

3. Start it. With Caddy in front, which obtains and renews the certificate by itself:

   ```sh
   docker compose --profile tls up -d
   ```

   Or without Caddy, when a web server of yours already holds ports 80 and 443 (see _Proxies_); Varians then answers on 127.0.0.1:3000 only:

   ```sh
   docker compose up -d
   ```

4. Open the site and register the first account at once: it becomes the administrator (see _The first account_).

`docker compose ps` shows whether the services are healthy, `docker compose logs -f varians` what Varians writes. The data lives in named volumes: `varians_db` (the database), `varians_storage` (images, tiles, archives) and `varians_backups`.

Commands are given to the running container with `docker compose exec varians varians <command>`, for instance `docker compose exec varians varians cli make-admin you@example.org`.

## Native

As root, for release 0.2.0 on x64 (replace `x64` with `arm64` on an ARM server):

1. **A system user** for Varians, whose home is its state directory:

   ```sh
   useradd --system --home-dir /var/lib/varians --shell /usr/sbin/nologin varians
   ```

2. **The database.** PostgreSQL lets the system user `varians` in as the database user `varians` through its socket without a password (peer authentication, the default for local connections in the Debian, Ubuntu and Arch packages):

   ```sh
   sudo -u postgres createuser varians
   sudo -u postgres createdb --owner=varians --encoding=UTF8 varians
   ```

3. **The release**, under `/opt/varians/releases`, with the link `current` pointing at the one in use:

   ```sh
   mkdir -p /opt/varians/releases && cd /opt/varians
   base=https://github.com/polemistes/varians/releases/download/v0.2.0
   curl -fsSLO "$base/varians-0.2.0-linux-x64.tar.gz"
   curl -fsSLO "$base/varians-0.2.0-linux-x64.tar.gz.sha256"
   sha256sum -c varians-0.2.0-linux-x64.tar.gz.sha256
   tar -C releases -xzf varians-0.2.0-linux-x64.tar.gz
   ln -sfn /opt/varians/releases/varians-0.2.0-linux-x64 /opt/varians/current
   ```

   A release holds `app/` (the application with its dependencies), `bin/varians`, `deploy/` (the systemd units, proxy snippets and settings examples), and `docs/` (these guides and the format specification, `docs/formats`, which the archives carry and the site serves; the unit names it with `VARIANS_FORMATS_DIR`).

4. **The settings**, readable by root and the group varians only:

   ```sh
   install -d -m 750 -g varians /etc/varians
   install -m 640 -g varians /opt/varians/current/deploy/native/varians.env.example /etc/varians/varians.env
   ```

   Edit `/etc/varians/varians.env`: at least `ORIGIN`. Quote a value that contains spaces or angle brackets, as the example does with `MAIL_FROM`.

5. **The service** and the nightly backup:

   ```sh
   cp /opt/varians/current/deploy/native/varians.service \
      /opt/varians/current/deploy/native/varians-backup.service \
      /opt/varians/current/deploy/native/varians-backup.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now varians varians-backup.timer
   ```

   The unit runs `varians serve`, which applies the migrations and starts the server on 127.0.0.1:3000. The files of the installation live in `/var/lib/varians` (`storage/`, `backups/`), which systemd makes and gives to the user varians.

   systemd takes only absolute paths, so the units cannot name files relative to the release they came in: they name `/opt/varians/current` and `/etc/varians/varians.env`. To install elsewhere, change `ExecStart`, `EnvironmentFile` and `VARIANS_FORMATS_DIR` with `systemctl edit varians` (and the same for varians-backup).

6. **A proxy** in front (see _Proxies_), then register the first account.

Commands are run as the user varians: `sudo -u varians /opt/varians/current/bin/varians <command>`. `bin/varians` reads `/etc/varians/varians.env` by itself when no `DATABASE_URL` is set, or the file named by `VARIANS_ENV_FILE`. `systemctl status varians` shows whether it runs, `journalctl -u varians -e` what it writes.

The installation of varians.eu itself is built from a checkout of the repository instead, pushed to the server with `deploy/push.sh`; [deploy/README.md](../deploy/README.md) describes it.

## Proxies

Varians listens on 127.0.0.1:3000 and leaves TLS to a web server in front. Whatever the server, it must:

- pass every request on to `http://127.0.0.1:3000` with the original `Host`;
- add the visitor's address to `X-Forwarded-For` (Varians counts login and reset attempts by it, with `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=1`; with more than one proxy in a row, raise `XFF_DEPTH` to their number);
- accept request bodies of 100 MB (image uploads), and wait up to five minutes for an answer (imports and archive exports).

The examples:

- **Caddy**: the `Caddyfile` beside `compose.yaml`, used by `--profile tls`. Caddy does all of the above by default.
- **nginx**: [deploy/nginx/varians.conf](../deploy/nginx/varians.conf). Replace the domain and the certificate paths.
- **Apache**: [deploy/apache/varians.eu.conf](../deploy/apache/varians.eu.conf) (port 80) and [varians.eu-ssl.conf](../deploy/apache/varians.eu-ssl.conf) (port 443) are the configuration of varians.eu; replace the domain. They need `mod_proxy_http`, `mod_headers`, `mod_rewrite` and `mod_ssl`.

With Docker Compose and your own proxy on the same machine, point it at `127.0.0.1:3000` (or the port in `VARIANS_PORT`).

## Settings

With Docker Compose the settings are in `.env` beside `compose.yaml`; natively in `/etc/varians/varians.env` (the unit sets some of them itself, and the file overrides those). After a change: `docker compose up -d`, or `systemctl restart varians`.

| Setting                       | Meaning                                                                                                                                                                                                                                                                                                                                                        | Default                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ORIGIN`                      | The public address of the site, as visitors type it (`https://editions.example.org`). Used in links, in mail, and to check that forms are sent from the site itself. Required.                                                                                                                                                                                 | none                                                                                            |
| `DATABASE_URL`                | The PostgreSQL connection. Compose sets it from `POSTGRES_PASSWORD`; natively `postgresql://varians@/varians?host=/run/postgresql` (peer authentication through the socket).                                                                                                                                                                                   | none                                                                                            |
| `POSTGRES_PASSWORD`           | Compose only: the database's password. Letters and digits only, since it is written into a connection address.                                                                                                                                                                                                                                                 | none                                                                                            |
| `DOMAIN`                      | Compose with `--profile tls` only: the host name Caddy obtains a certificate for.                                                                                                                                                                                                                                                                              | none                                                                                            |
| `SITE_NAME`                   | The installation's name, used in mail, citations and package metadata.                                                                                                                                                                                                                                                                                         | Varians                                                                                         |
| `DATA_LICENCE`                | The licence under which published scholarly records are released: `CC-BY-SA-4.0`, `CC-BY-4.0` or `CC0-1.0` (see "Licences and rights" in guide.md). A record keeps the licence it was first published under, so change this only before anything is published. Packages from installations with a licence that cannot be published under this one are refused. | CC-BY-SA-4.0                                                                                    |
| `SMTP_URL`                    | The mail server, see _Mail_. Empty: no mail.                                                                                                                                                                                                                                                                                                                   | empty                                                                                           |
| `MAIL_FROM`                   | The sender of the mail, `"Name <address>"`.                                                                                                                                                                                                                                                                                                                    | the site's name at noreply@ the host of `ORIGIN`                                                |
| `STORAGE_DIR`                 | Where the images, tiles and archives are kept.                                                                                                                                                                                                                                                                                                                 | `/data/storage` in the image; `/var/lib/varians/storage` natively                               |
| `BACKUP_DIR`                  | Where `varians backup` writes when no directory is given.                                                                                                                                                                                                                                                                                                      | `/data/backups`; `/var/lib/varians/backups`                                                     |
| `BACKUP_KEEP`                 | How many backups in `BACKUP_DIR` are kept; older ones are deleted after each backup. 0 keeps all.                                                                                                                                                                                                                                                              | 14                                                                                              |
| `BODY_SIZE_LIMIT`             | The largest request body accepted, in bytes.                                                                                                                                                                                                                                                                                                                   | 104857600 (100 MB) in the examples                                                              |
| `ADDRESS_HEADER`, `XFF_DEPTH` | Where the visitor's address is found behind a proxy (see _Proxies_).                                                                                                                                                                                                                                                                                           | `X-Forwarded-For`, 1 in the examples                                                            |
| `HOST`, `PORT`                | Where the server listens.                                                                                                                                                                                                                                                                                                                                      | `0.0.0.0:3000` in the image; `127.0.0.1:3000` natively                                          |
| `ARCHIVE_INTERVAL_HOURS`      | Hours between the passes that write changed works to the archives.                                                                                                                                                                                                                                                                                             | 24                                                                                              |
| `ARCHIVE_SCHEDULER`           | `off` stops those passes (for a second instance on the same data, for instance).                                                                                                                                                                                                                                                                               | on                                                                                              |
| `ARCHIVE_WRITE_DELAY_SECONDS` | Seconds a record must be left alone before its archive files are rewritten; between these writes the archive follows every change.                                                                                                                                                                                                                             | 60                                                                                              |
| `SECRET_KEY`                  | A long random string (at least 16 characters), used to encrypt the tokens of accounts on other installations that a work's maintainers keep for pulling and pushing. Without it, other installations can only be pulled from where their works are public. Keep it with the backups: without it the stored tokens cannot be read.                              | none                                                                                            |
| `SOURCE_URL`                  | If you run a changed Varians: the address of its source code, which the footer links. See _The source code_.                                                                                                                                                                                                                                                   | the public repository at the running commit                                                     |
| `VARIANS_FORMATS_DIR`         | Where the format specification (`docs/formats`) is.                                                                                                                                                                                                                                                                                                            | `/opt/varians/docs/formats` in the image; set by the native unit; found beside `bin/` otherwise |
| `VARIANS_VERSION`             | Compose only: the image tag to run, for instance `0.2` to follow the 0.2 releases.                                                                                                                                                                                                                                                                             | latest                                                                                          |
| `VARIANS_PORT`                | Compose only: the port on 127.0.0.1 where Varians answers for your own proxy.                                                                                                                                                                                                                                                                                  | 3000                                                                                            |
| `VARIANS_ENV_FILE`            | For `bin/varians` run by hand: a settings file to read.                                                                                                                                                                                                                                                                                                        | `/etc/varians/varians.env` if present                                                           |

## Mail

With `SMTP_URL` set (and `ORIGIN`, from which every link is made), Varians sends three kinds of message:

- At registration, a link to confirm the address, valid for a day. The account cannot be used until the address is confirmed; logging in before then sends a new link. Accounts made before release 0.2.0 count as confirmed; an account made while the installation sent no mail is asked to confirm its address at its first login after mail is turned on.
- On request from the login page (**Forgotten your password?**), a link to set a new password, valid for an hour. The answer on the page is the same whether or not an account has the address, and at most three messages an hour go to one address.
- From the administrators' users page, **Send reset link**: a link to set a new password, valid for a day.

Every link can be used once. Setting a new password ends every session of the account.

`SMTP_URL` takes the form `smtps://user:password@mail.example.org:465` (TLS from the start) or `smtp://user:password@mail.example.org:587` (STARTTLS). Characters such as `@` or `:` in the user or the password are written `%40` and `%3A`.

Without mail, registration works without confirmation, the page for a forgotten password says to ask the administrator, and the administrator makes the link: **Make reset link** on the users page shows it, and so does the command line:

```sh
docker compose exec varians varians cli reset-password someone@example.org
sudo -u varians /opt/varians/current/bin/varians cli reset-password someone@example.org
```

The link is valid for a day and for one use; give it to the person by a means you trust.

## The first account

The first account registered on an empty installation becomes its administrator: register yours as soon as the site answers. With mail, its address must be confirmed like any other. If the mail does not arrive, confirm it from the command line with `varians cli confirm-email you@example.org`.

To make another account an administrator, use the users page under **Administration**, or `varians cli make-admin someone@example.org`.

## Backups and restoring

`varians backup` writes a directory holding `varians.dump` (the database, in PostgreSQL's custom format), `storage.tar.gz` (images, tiles and archives) and `backup.txt` (the version and the time). Without a directory given, it writes to `BACKUP_DIR/<time>` and keeps the newest `BACKUP_KEEP`.

- **Compose**: `docker compose exec varians varians backup`. Run it every night from the host's cron, for instance `30 3 * * * cd /path/to/varians && docker compose exec -T varians varians backup`. Copy the backups off the machine: `docker compose cp varians:/data/backups ./backups`.
- **Native**: the timer `varians-backup.timer` runs it every night at 03:30. Copy `/var/lib/varians/backups` to another machine as well.

A backup on the same disk as the data is no backup against the loss of the disk.

`varians restore <dir>` replaces the database and everything in the storage with a backup. Stop the server first. The database is replaced in one transaction, and the storage only once the database has been restored, so a backup that cannot be read changes nothing. A backup from an earlier release is brought up to this one by the migrations that follow.

```sh
# Compose
docker compose stop varians
docker compose run --rm varians restore /data/backups/<time> --yes
docker compose start varians

# Native
systemctl stop varians
sudo -u varians /opt/varians/current/bin/varians restore /var/lib/varians/backups/<time> --yes
systemctl start varians
```

A backup made elsewhere is first copied in: `docker compose cp ./<time> varians:/data/backups/`. `restore` also reads the backups of varians.eu's own `deploy/backup.sh` (a `storage/` directory instead of `storage.tar.gz`).

## Upgrading and going back

Read the release notes in [CHANGELOG.md](../CHANGELOG.md) first, and make a backup.

- **Compose**: `docker compose pull && docker compose up -d`. With `VARIANS_VERSION` set, change it to the new version first.
- **Native**: unpack the new release beside the old one, point the link at it, restart:

  ```sh
  tar -C /opt/varians/releases -xzf varians-<new>-linux-x64.tar.gz
  ln -sfn /opt/varians/releases/varians-<new>-linux-x64 /opt/varians/current
  systemctl restart varians
  ```

  If the new release's units differ (the release notes say so), copy them to `/etc/systemd/system/` again and run `systemctl daemon-reload`.

`varians serve` applies the new migrations at the start. Migrations only add, so going back to the earlier release is the same step in reverse (set `VARIANS_VERSION` to the earlier version, or point the link at the earlier release), and the earlier release runs on the newer database. What a newer release wrote into its new tables is then not used; to undo it entirely, restore the backup made before the upgrade.

`GET /health` answers `{"status":"ok","version":"…","database":"ok"}` with status 200 when the server can serve, and 503 when the database cannot be reached or is behind the release; `"database":"ahead"` means an earlier release runs on a newer database, which is allowed. `GET /api/version` gives the version and the address of its source. The footer of every page shows the version too.

## The dictionaries

The reader and the workbench look Greek words up in the Liddell-Scott-Jones and the Intermediate Liddell-Scott lexica and in the morphological analyses of the Ancient Greek Dependency Treebank and of Morpheus. The lexicon is too large to be part of a release (29 MB built, 370 MB of sources), so it is built once by the maintainer of Varians and imported by each installation ([lexicon.md](lexicon.md)):

```sh
docker compose exec varians varians lexicon
sudo -u varians /opt/varians/current/bin/varians lexicon
```

This downloads the lexicon published for the release (29 MB, checked against its SHA-256) and loads it in one transaction, replacing whatever was loaded before; it takes under a minute. Until a lexicon is published for a release, the command says so. `varians lexicon import FILE|URL [--sha256 HEX]` loads a lexicon exported by another installation instead, for instance one built with `varians lexicon build`, which downloads some 370 MB of sources (lexicon.md says what it needs). A file on the host reaches the container with `docker compose cp lexicon.jsonl.gz varians:/tmp/lexicon.jsonl.gz`. The data is licensed CC BY-SA, as the page Sources and licences states.

## Where the data is

- **The database** holds everything that is edited: the registry, the transcriptions and editions with their full history, the accounts.
- **The storage** (`STORAGE_DIR`) holds `images/` (each upload as it came), `tiles/` (the pyramids the viewer shows) and `archives/`: one git repository per work, with the work's records, transcriptions and editions as open files (JSON and TEI, specified in [formats/](formats/)). The archives are a second, independent copy of the scholarship, written after changes and every night; they outlive the application. `varians cli export-all` writes every changed work at once; `varians cli import-archive <dir> --user <email>` reads one back.

In the container the storage is the volume `varians_storage` at `/data/storage`; natively `/var/lib/varians/storage`.

## The source code

Varians is free software under the GNU Affero General Public License, version 3 or later. The licence asks that the users of a network service can obtain the source of the version that runs it. The footer of every page links the source of the running version, which meets this for an unchanged release. If you change Varians, publish your changes and set `SOURCE_URL` to where they are.

Security problems are reported privately, as [SECURITY.md](../SECURITY.md) describes.

## Terms of contribution

`docs/terms.md` holds the terms every account accepts before it edits or publishes, with their version in the front matter (`version: 1`). Read them before opening an installation, and change them to suit it: they speak of "the operator of this installation", which is you. When you change their substance, raise the version; every account is then asked to accept the new version at its next edit, and can go on reading meanwhile. The terms are part of the release: change them in your checkout or image, not on the server.

## Other installations

Works move between installations as packages (see "The archive" in guide.md): downloaded from a work's, edition's or transcript's page and brought in under **Import…**, or pulled and pushed from a work's page under **Other installations** by its maintainers. Pulling a work's published records needs nothing; pulling drafts, and pushing, need a token of an account on the other installation (made on that account's page) and `SECRET_KEY` here to keep it. A pull can be repeated every so many hours; conflicts it meets are reported and left for a maintainer. From the command line: `varians cli pull <work-slug> <address there> --user <email> [--token <token>]` and `varians cli push <work-slug> <address there> --user <email> --token <token>`.
