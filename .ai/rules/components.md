---
paths:
  - 'app/Support/TranscriptionMarkup/**,resources/js/lib/transcriptionMarkup.ts,resources/js/components/AlignableText.vue'
---

# Components

## Transcription markup: Leiden-inspired inline syntax, deliberately narrow
`TranscriptionSegment.text` may contain inline markup for exactly three things — nothing else. Do not extend it for variants, apparatus, abbreviation expansion, or structural/citation numbering; those stay out of the text by design (citations come from the existing ReferenceScheme/CanonicalPassage mapping).

Grammar (`App\Support\TranscriptionMarkup\MarkupParser`, mirrored in `resources/js/lib/transcriptionMarkup.ts`):
- `[abc]` — text lost, editor restores as "abc" → TEI `<supplied reason="lost">abc</supplied>`
- `[3]` / `[?]` — lost, extent known/unknown → `<gap reason="lost" quantity="3" unit="character"/>` / `<gap reason="lost"/>`
- `{3}` / `{?}` — ink survives but illegible, extent known/unknown → `<unclear><gap reason="illegible" .../></unclear>`
- `_abc_` — read as "abc" but uncertain → `<unclear>abc</unclear>`

No nesting; `[`, `]`, `{`, `}`, `_` are reserved and forbidden as literal text outside these forms. `MarkupParser::parse()` is the validity authority (used via `App\Rules\ValidTranscriptionMarkup` on segment store/update); the TS parser is deliberately lenient (falls back to plain text on unclosed delimiters) since it only drives live rendering, not validation. `TeiExporter::toXmlFragment()` renders the TEI subset.

**Non-obvious constraint**: `TranscriptionRegion.start_offset`/`end_offset` (image-alignment) index into the raw `segment.text` string, delimiters included. `AlignableText.vue` renders markup styling by wrapping the *same* raw characters in extra `<span>`s — it never strips or transforms them — specifically so those offsets stay valid. If markup rendering is ever changed to show a "typeset" projection (e.g. real dot-notation, hidden underscores), region offsets must be remapped too, or the two features will silently desync.
