---
paths:
  - 'tests/Feature/**'
---

# Feature

## The pre-push gate is `composer ci:check`, not the individual tools
GitHub Actions runs `composer ci:check` on every push to main: eslint
(`npm run lint:check`), **`prettier --check resources/`**
(`npm run format:check`), phpstan, and the test suite. Running pint, phpstan,
vue-tsc, build and tests individually misses prettier and eslint — a
hand-written Vue template broke CI exactly that way (real incident). Run
`composer ci:check` (or at minimum add `npm run format:check` and
`npm run lint:check`) before any push.

## Image fakes in tests
GD is available in this environment, so `UploadedFile::fake()->image(...)` works when a test genuinely needs real pixel data (e.g. a `dimensions:` rule).

Existing image tests use `UploadedFile::fake()->create($name, $kilobytes, $mimeType)` (e.g. `UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg')`) — it fakes the MIME type without rendering an image and still passes the `image` validation rule, which checks the reported MIME type, not the pixels. Prefer `->create(...)` unless a test actually asserts on width/height.
