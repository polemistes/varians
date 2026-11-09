# Varians

A platform for making and reading digital scholarly editions of ancient texts: transcriptions of witnesses with their facsimiles, automatic collation, a critical text edited like any text with its apparatus derived from the witnesses, a reader, a full history of every change, and an archive of open files that outlives the application.

- [docs/guide.md](docs/guide.md) is how to use it, for editors.
- [PLAN.md](PLAN.md) is the design, and the record of the decisions taken.
- [PLAN-2.md](PLAN-2.md) is the plan for the data formats as a specification, the archive, sharing between installations, licences and installation (November 2026).
- [docs/brief.md](docs/brief.md) is what was asked for, in the owner's words.
- [docs/formats/](docs/formats/) specifies the archive and the TEI subset.
- [docs/web-conventions.md](docs/web-conventions.md) is how code in the web app is written.
- [deploy/](deploy/) is how it runs on a server.

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
