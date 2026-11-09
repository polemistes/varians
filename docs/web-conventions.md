# Conventions for apps/web

This file is for everyone writing code in `apps/web`.

## Stack

SvelteKit 2 with Svelte 5 (runes mode everywhere), TypeScript strict, Tailwind CSS 4 (`@import 'tailwindcss'` in `src/app.css`, design tokens as CSS custom properties in `@theme`), Bits UI for accessible primitives, `@lucide/svelte` for icons until the owner's icons arrive, Drizzle with PostgreSQL through `@varians/db`, the domain through `@varians/core`. No other dependencies without asking the lead.

## Structure

```
src/
  app.css                   tokens, fonts, base styles
  app.html
  hooks.server.ts           session lookup → event.locals.user, event.locals.db
  lib/
    server/
      db.ts                 the Drizzle client from DATABASE_URL (one per process)
      auth.ts               passwords (argon2), sessions, cookies
      authz.ts              who may see or edit what
      <feature>/            server-only logic per feature (documents, images, archive, ...)
    components/
      ui/                   primitives: Button, Field, Input, Select, Dialog, Menu, Popover, Toast, Tabs
      shell/                header, navigation, page frame
      <feature>/            feature components (editor, facsimile, apparatus, ...)
    strings/                every user-facing string: en.ts for the shell and common screens, one module per larger screen
    types.ts                shared client types
  routes/
    (public)/               library, reader, login, register
    (app)/                  everything that needs a user
    api/                    JSON endpoints for the editors
```

## Rules

- **Server does authorization.** Every load function and action checks `authz` helpers. Pages never decide; they show or hide by `can` flags the server returns.
- **Loads return plain data**; mutations go through form actions for ordinary pages and JSON endpoints under `/api` for the editors (which send operations with a document version).
- **Strings live in `src/lib/strings/`.** `en.ts` holds the shell and the common screens (imported as `s` from '$lib/strings'); each larger screen has its own module (editor, edition, registry, pages, workbench, reader, history, bibliography). No user-facing text inline in components.
- **Components are small.** A route's `+page.svelte` composes feature components; feature components own their state with runes (`$state`, `$derived`, `$effect`) and take plain props.
- **Styling** uses Tailwind utilities and the tokens in `app.css`: colours `--color-*`, fonts `--font-serif` (text) and `--font-sans` (interface). No inline hex colours. Light and dark mode through `prefers-color-scheme` and a `data-theme` attribute on `<html>`.
- **Text is serif, interface is sans.** Greek, Latin and every transcribed text use `font-serif`; controls, labels and navigation use `font-sans`.
- **Keyboard first.** Every control reachable and operable by keyboard; focus visible; dialogs trap focus (Bits UI does this).
- **Imports**: `$lib/...` for app code; `@varians/core` and `@varians/db` for the packages; relative imports inside the packages carry `.ts`.
- **Tests**: `*.test.ts` beside the code for pure logic (vitest, `pnpm --filter @varians/web test`); Playwright under `e2e/` for behaviour in a browser.
- **Prose** in comments, strings and documents: plain British English with Oxford spelling (-ize where British usage allows it: normalized, organize; but analyse, catalogue, colour, centre, licence as the noun), no em dashes. The conventional terms of textual scholarship: diplomatic and normalized, interpretative variants.
- **Do not** run `pnpm install`, add dependencies, or edit files outside your assignment without telling the lead.
