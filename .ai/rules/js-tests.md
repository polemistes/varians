---
paths:
  - 'resources/js/**/*.test.ts,vitest.config.ts'
---

# Js Tests

## There IS a JavaScript suite now, and `composer ci:check` runs it
`npm run test` (vitest, jsdom) — `npm run test:watch` while working. It runs
inside `composer ci:check`, between the type check and the PHP suite, so the
pre-push gate is still the one command.

Tests live BESIDE the code as `*.test.ts`. `vitest.config.ts` is deliberately
separate from `vite.config.ts`: the app's config carries the Laravel,
Inertia, Tailwind and Wayfinder plugins, and Wayfinder shells out to artisan.
It is in ESLint's ignore list for the same reason `vite.config.ts` is —
neither is in the tsconfig project.

## What belongs in it: what only a DOM can answer
The suite was added after a defect no other check could see. The editor
reads which side of an assignment's marker the caret stands on and puts it on
the edit; the pane then re-measured the offsets by REBUILDING the op, and
the side died there. Both ends were correct and every existing test passed —
the PHP tests post their own ops, with the side already on them, straight
past the gap.

So: the transcription editor's caret and assignment-claim behaviour, and
`lib/transcriptionEdit.ts` — the client mirror of `SpanTransformer`, which
must agree with it case for case or an assignment jumps the moment a save
lands. Anything the PHP suite can reach stays in the PHP suite.

## What jsdom CANNOT see — still verify these in a browser
There is no layout: no caret rectangles, no line wrapping, no line-break
affinity, no default key actions. So the suite cannot tell you WHERE a caret
is drawn, which line it lands on, or what an arrow key, Home or a click
does — every one of which has been a real reported bug here. Drive a real
browser for those (see .ai/rules/pages-transcriptions.md), and do not read a
green suite as covering them.

Two things jsdom's `InputEvent` does not carry, which the surface's tests
stub on the instance: `getTargetRanges()` (the range an input event targets —
the editor's whole op depends on it) and `dataTransfer` (a paste's text).
