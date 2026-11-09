# Varians

A platform for making and reading digital scholarly editions of ancient texts: transcriptions of witnesses with their facsimiles, automatic collation, a critical text edited like any text with its apparatus derived from the witnesses, a reader, a full history of every change, and an archive of open files that outlives the application.

- [docs/guide.md](docs/guide.md) is how to use it, for editors.
- [docs/install.md](docs/install.md) is how to install and run it, for operators.
- [docs/formats/](docs/formats/) specifies the archive and the TEI subset.
- [docs/web-conventions.md](docs/web-conventions.md) is how code in the web app is written.
- [deploy/](deploy/) holds the systemd units, proxy snippets and scripts of the native installation, and how varians.eu itself is deployed.
- [CHANGELOG.md](CHANGELOG.md) is what changed in each release; [SECURITY.md](SECURITY.md) is how to report a vulnerability.

## Installing

Releases are published at [github.com/polemistes/varians/releases](https://github.com/polemistes/varians/releases): a container image, `ghcr.io/polemistes/varians`, and a tarball for Linux on x64 and arm64. The quickest way to run one is Docker Compose:

```sh
mkdir varians && cd varians
for f in compose.yaml Caddyfile .env.example; do
  curl -fsSLO "https://raw.githubusercontent.com/polemistes/varians/v0.2.0/$f"
done
cp .env.example .env      # then set ORIGIN, DOMAIN and POSTGRES_PASSWORD
docker compose --profile tls up -d
```

[docs/install.md](docs/install.md), the operators' guide, describes this and the native installation, the proxies, every setting, mail, backups, upgrades and the dictionaries.

## Layout

| | |
|---|---|
| `packages/core` | The domain, with no dependency on the browser or the database: token streams and operations, reference schemes, normalization, collation, the apparatus, adoption, TEI and other formats, history. Fully unit tested. |
| `packages/db` | The PostgreSQL schema (Drizzle) and migrations. |
| `apps/web` | The SvelteKit application: pages, editors, reader, API, server logic. |

## Running it locally

Requirements: Node 24 or later, pnpm, PostgreSQL 16 or later.

```sh
pnpm install
pnpm db:start            # a user-level PostgreSQL cluster in ~/.local/share/varians (first: see below)
pnpm db:migrate
pnpm --filter @varians/web seed   # the first administrator: test@example.com / password
pnpm dev                 # http://localhost:5173
```

First-time database setup without a system PostgreSQL:

```sh
initdb -D ~/.local/share/varians/pgdata --auth=trust --encoding=UTF8 --locale=C.UTF-8 -U varians
mkdir -p ~/.local/share/varians/run
pnpm db:start
psql -h 127.0.0.1 -p 54329 -U varians -d postgres -c 'create database varians_dev' -c 'create database varians_test'
```

Settings live in `apps/web/.env` (copy `.env.example`).

## Tests

```sh
pnpm --filter @varians/core test        # the domain
pnpm --filter @varians/web test         # server logic and the editor bridge, against varians_test
pnpm --filter @varians/web test:e2e     # the browser
pnpm check                              # types
```

## Command line

```sh
pnpm --filter @varians/web cli seed-sample --user you@example.org
pnpm --filter @varians/web cli export-archive iliad
pnpm --filter @varians/web cli import-archive /path/to/archive --user you@example.org
```

## Licences

Varians is free software. The application is licensed under the GNU Affero General Public License, version 3 or later ([LICENSE](LICENSE)); the domain package `packages/core` under the Apache License 2.0 ([packages/core/LICENSE](packages/core/LICENSE)); the format specification in `docs/formats` under CC BY 4.0, with its schemas under the BSD 2-Clause licence ([docs/formats/LICENSE](docs/formats/LICENSE)). The data and fonts that come with it are listed with their licences on the page Sources and licences of every installation.
