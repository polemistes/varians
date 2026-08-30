---
paths:
  - 'resources/js/components/AlignableText.vue,resources/js/pages/Transcriptions/Editor.vue'
---

# Pages Transcriptions

## "Edit text" is a third, mutually-exclusive AlignableText mode — a controlled contenteditable
`AlignableText.vue` takes an `editable` prop; when true the root span becomes `contenteditable` and every mutating `beforeinput` is `preventDefault()`-ed and translated into an exact `{start, end, text}` op (via `getTargetRanges()` + the existing `offsetAt()` helper), emitted up to the parent as `edit` rather than letting the browser mutate the DOM — chunks are freshly re-rendered `<span>`s with no stable per-character identity, so the component owns every mutation and explicitly restores the caret afterward via `pointAt()` (the inverse of `offsetAt()`) through `nextTick()`. IME composition is deliberately let through unmanaged (`event.isComposing` short-circuits) and resynced once at `compositionend`.

`Editor.vue` replaced the old always-present "compose" `<textarea>` entirely — even a brand-new blank transcription uses this same editable view from the start (`interactionMode` defaults to `'edit'` when `text === ''`). `interactionMode` is `'align' | 'assign' | 'edit'`, mutually exclusive; switching away from `'edit'` with unsaved `editOps` prompts a `window.confirm` before discarding. Text edits accumulate client-side (`editOps`) and apply live via `transcriptionEdit.ts` for instant visual feedback, but only persist on an explicit Save (no autosave) — see `TranscriptionTextController`.

Citation badges need `contenteditable="false"` explicitly (atomic caret-skippable islands) and their click handler is inert while `editable` — don't remove either when touching badge rendering. An empty editable region needs a `v-if="editable && chunks.length === 0"` real placeholder `<span data-non-text contenteditable="false">` — CSS `:empty` does NOT work here since Vue's compiled `v-for` always leaves comment-node fragment markers, which count as children and permanently defeat `:empty` matching.
