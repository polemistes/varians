# Varians

Digital scholarly editions of ancient texts. A pnpm monorepo: `packages/core` (the domain, pure), `packages/db` (schema and migrations), `apps/web` (SvelteKit application and command line).

## Where the truth is

- **`docs/design.md` is the design.** Read the section concerned before changing how something works, and rewrite it in the same commit when a decision changes. It holds no history.
- `docs/guide.md` (use), `docs/formats/specification.md` (data format, normative), `docs/install.md` (operation and settings), `docs/web-conventions.md` (code in apps/web), `apps/web/README.md` ("Where things are": the map of the source).
- `docs/notes/plans/` holds the old plans. They are history and contradict one another: do not consult them for design.

## Commands

```sh
pnpm db:start                          # the development PostgreSQL (port 54329); pnpm db:stop
pnpm dev                               # http://localhost:5173, login test@example.com / password
pnpm format                            # Prettier over the repository; CI fails on unformatted files
pnpm check                             # types, all packages
pnpm --filter @varians/core test       # the domain; no database
pnpm --filter @varians/web test        # server logic; needs the database (uses varians_test)
pnpm --filter @varians/web test:e2e    # Playwright; starts its own server on 4173
pnpm build
pnpm db:generate                       # a new migration from a schema change
pnpm --filter @varians/web cli <command>
```

One test file: `pnpm --filter @varians/web exec vitest run <path>`.

## Checking a change

In this order, each in its own call, never in parallel: `pnpm format`, `pnpm check`, core tests, web tests, then Playwright alone (stop any dev server first; two browsers at once exhaust this machine's memory), then `pnpm build` when the build could be affected. Run only what the change can touch while working; run all of it before committing something substantial.

`varians_dev` holds the owner's own trial data: never reset it. `varians_test` may be dropped and recreated.

## Rules of the work

- **Formatting** is Prettier's, always: run `pnpm format` (or `pnpm exec prettier --write <files>`) before every commit. Files written by programs are listed in `.prettierignore` and left as their programs write them. Prettier writes Markdown italics as `_word_`, which the site's own renderer (`apps/web/src/lib/guide/markdown.ts`) reads.
- **Prose** in code comments, strings and documents: British English with Oxford -ize, no em dashes. The fixed terms and the rules for interface text are in `docs/design.md`, section 4. Every user-facing string lives in `apps/web/src/lib/strings/`.
- **A change users see** goes into `docs/guide.md` and under Unreleased in `CHANGELOG.md`. A change to the data format goes into the specification first.
- **Migrations** only add, unless the changelog says to back up first. Never edit a migration that has been applied. Test a migration against a seeded database, not only a fresh one.
- **Comments** say what the code does and why, not which plan or task asked for it.
- **Commits**: one plain sentence saying what is now the case, no prefix, when a piece of work is done and checked. Push `main` when it is. Never rewrite history without asking.
- **The repository is public.** No server names, logins, addresses or personal details in tracked files. `deploy/host`, `deploy/LOCAL.md`, `docs/notes/` and `docs/brief.md` are not tracked. This file is public: it says how to work on Varians, and holds nothing about a particular machine or server.
- **Deploying** is done only when asked, by `deploy/push.sh`, following `deploy/README.md`. Take a backup first when a migration changes or drops a column.
