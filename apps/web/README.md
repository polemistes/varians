# @varians/web

The SvelteKit application of Varians: the pages, the editors, the API routes and the reader. Read [../../docs/web-conventions.md](../../docs/web-conventions.md) first.

## Setup

PostgreSQL runs locally on port 54329 (`pnpm db:start` at the root). Copy `.env.example` to `.env` if it is missing, then migrate and seed:

```sh
pnpm --filter @varians/db migrate
pnpm --filter @varians/web seed       # test@example.com / "password", an administrator
```

The seed is idempotent. The first account registered on an empty installation becomes its administrator.

## Development

```sh
pnpm --filter @varians/web dev        # http://localhost:5173
pnpm --filter @varians/web check      # svelte-check
pnpm --filter @varians/web build      # production build with adapter-node
pnpm --filter @varians/web preview
```

`.env` carries `DATABASE_URL`, `STORAGE_DIR` and `ORIGIN`. Session cookies are `Secure` when `ORIGIN` is https.

## Tests

Unit tests live beside the code as `*.test.ts` and run with Vitest:

```sh
pnpm --filter @varians/web test
```

Browser tests live in `e2e/` and run with Playwright against a dev server on port 4173 that uses `.env.test`, that is the `varians_test` database. Once:

```sh
DATABASE_URL=postgres://varians@127.0.0.1:54329/varians_test pnpm --filter @varians/db migrate
pnpm --filter @varians/web exec playwright install chromium
```

Then:

```sh
pnpm --filter @varians/web test:e2e              # against `vite dev --mode test`
E2E_BUILD=1 pnpm --filter @varians/web test:e2e  # against the production build
```

Playwright starts the server itself (and reuses one already listening on 4173). Every run registers a fresh account; nothing in `varians_test` is cleaned up, so drop and recreate the database when it grows.

## The stress edition

A made-up verse work in thirty witnesses, with every kind of element a real edition has, to measure how Varians copes with one. Both commands refuse `varians_dev`; give them a database of their own.

```sh
pnpm --filter @varians/web cli seed-stress --user you@example.org [--lines 1300] [--witnesses 30] [--seed 1] [--history 300] [--slug stress] [--replace]
pnpm --filter @varians/web exec tsx scripts/stress.ts --slug stress [--json FILE] [--keep-cache] [--seed 1]
```

The seeder writes everything but the registry rows through the application's own services. The script prints a table of timings and sizes, and fifteen lines with their apparatus to read; it empties the edition's collation cache first (derived data) and puts back every transcript it saves to.

## A printed page worked backwards

To see whether Varians can say what a printed apparatus says, a description file (the printed lines, which witness reads what where, the conjectures and the readings reported from sources that are not transcribed; `src/lib/server/seed/page.ts` has its fields) is worked backwards into transcripts, an edition that reads the printed text, and the records an editor would enter. The second command prints, line by line, the printed apparatus and the one Varians derives, in the positive and the negative form, then what found no place. Both refuse `varians_dev`; the description may be in copyright, so keep it outside the repository (`local/` is ignored).

```sh
pnpm --filter @varians/web cli seed-page <file> --user you@example.org [--replace]
pnpm --filter @varians/web exec tsx scripts/page.ts <file> [--json FILE]
```

## Where things are

```
src/
  app.css                   tokens (@theme), fonts, base styles
  hooks.server.ts           session cookie → locals.user, locals.db; theme attributes on <html>
  lib/
    server/                 everything that touches the database (never imported by the browser)
      auth.ts, authz.ts     accounts and sessions; who may see or edit what
      documents/service.ts  the save protocol: operations, changesets, checkpoints, versions
      ops-schema.ts         the shape of operations a client may send
      collation.ts          an edition's collation context and the collation cache
      loaded-streams.ts     the texts of transcriptions and editions as loaded, kept while their rows are unchanged
      reader.ts             the view of an edition (whole, by stretch, or its outline): lines, sites, apparatus entries, drift
      registry.ts           works, witnesses, transcriptions, maintainers, search
      pages.ts, images/     witness pages, uploads, tiles, IIIF manifests
      workbench.ts          the transcription workbench's loads and imports
      seed/                 the sample edition; the stress edition (stress-text.ts makes its text, stress.ts writes it); a printed page worked backwards (page.ts)
      history.ts            sessions, moments, undo, bringing back, review
      publish.ts            publishing and the published versions
      bibliography.ts       the shared biblatex list and citations
      archive/              the open-format git archive per work, its scheduler and import
      import/               TEI and CTS import
    components/<feature>/   ui, shell, library, registry, pages, editor, workbench, edition, reader, history, bibliography, facsimile
    editor/                 the CodeMirror bridge between text and token streams
    edition/, workbench/, reader/, history/, bibliography/, registry/
                            pure helpers of each screen, with tests
    strings/                every user-facing string, one module per screen
  routes/
    (public)/               library, login, register, works and witnesses, the reader, the bibliography
    (app)/                  everything that needs a user: editors, new records, pages, account, admin
    transcriptions/[id]     the workbench, also the read-only view of a published transcription
    api/                    JSON endpoints of the editors
scripts/                    seed, cli, perf-edition (timing of a long edition), stress (measures the stress edition), page (a printed apparatus beside Varians')
e2e/                        Playwright tests
static/fonts/               EB Garamond and Cardo, self-hosted
```
