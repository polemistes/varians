---
paths:
  - 'tests/Feature/**'
---

# Feature

## Image fakes in tests
GD is available in this environment, so `UploadedFile::fake()->image(...)` works when a test genuinely needs real pixel data (e.g. a `dimensions:` rule).

Existing image tests use `UploadedFile::fake()->create($name, $kilobytes, $mimeType)` (e.g. `UploadedFile::fake()->create('folio.jpg', 500, 'image/jpeg')`) — it fakes the MIME type without rendering an image and still passes the `image` validation rule, which checks the reported MIME type, not the pixels. Prefer `->create(...)` unless a test actually asserts on width/height.
