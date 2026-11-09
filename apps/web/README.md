# @varians/web

The SvelteKit application of Varians: the pages, the editors, the API routes and the reader. Read [../../PLAN.md](../../PLAN.md) and [../../docs/web-conventions.md](../../docs/web-conventions.md) first.

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

## Where things are

```
src/
  app.css                   tokens (@theme), fonts, base styles
  hooks.server.ts           session cookie → locals.user, locals.db; theme attributes on <html>
  lib/
    server/                 everything that touches the database (never imported by the browser)
      auth.ts, authz.ts     accounts and sessions; who may see or edit what (PLAN 4.10)
      documents/service.ts  the save protocol: operations, changesets, checkpoints, versions
      ops-schema.ts         the shape of operations a client may send
      collation.ts          an edition's collation context and the collation cache
      reader.ts             the view of an edition: lines, sites, apparatus entries, drift
      registry.ts           works, witnesses, transcriptions, maintainers, search
      pages.ts, images/     witness pages, uploads, tiles, IIIF manifests
      workbench.ts          the transcription workbench's loads and imports
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
scripts/                    seed, cli, perf-edition (timing of a long edition)
e2e/                        Playwright tests
static/fonts/               EB Garamond and Cardo, self-hosted
```
