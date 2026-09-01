---
paths:
  - 'resources/js/components/AlignableText.vue,resources/js/pages/Transcriptions/Editor.vue'
---

# Pages Transcriptions

## "Edit text" is a third, mutually-exclusive AlignableText mode — a controlled contenteditable
`AlignableText.vue` takes an `editable` prop; when true the root span becomes `contenteditable` and every mutating `beforeinput` is `preventDefault()`-ed and translated into an exact `{start, end, text}` op (via `getTargetRanges()` + the existing `offsetAt()` helper), emitted up to the parent as `edit` rather than letting the browser mutate the DOM — chunks are freshly re-rendered `<span>`s with no stable per-character identity, so the component owns every mutation and explicitly restores the caret afterward via `pointAt()` (the inverse of `offsetAt()`) through `nextTick()`. IME composition is deliberately let through unmanaged (`event.isComposing` short-circuits) and resynced once at `compositionend`.

`Editor.vue` replaced the old always-present "compose" `<textarea>` entirely — even a brand-new blank transcription uses this same editable view from the start (`interactionMode` defaults to `'edit'` when `text === ''`). `interactionMode` is `'align' | 'assign' | 'edit'`, mutually exclusive; switching away from `'edit'` with unsaved `editOps` prompts a `window.confirm` before discarding. Text edits accumulate client-side (`editOps`) and apply live via `transcriptionEdit.ts` for instant visual feedback, but only persist on an explicit Save (no autosave) — see `TranscriptionTextController`.

Citation badges need `contenteditable="false"` explicitly (atomic caret-skippable islands) and their click handler is inert while `editable` — don't remove either when touching badge rendering. An empty editable region needs a `v-if="editable && chunks.length === 0"` real placeholder `<span data-non-text contenteditable="false">` — CSS `:empty` does NOT work here since Vue's compiled `v-for` always leaves comment-node fragment markers, which count as children and permanently defeat `:empty` matching.

## The witness page is the workbench; there is no separate transcription editor
`Witnesses/Show.vue` *is* the former `Transcriptions/Editor.vue`, with the
witness's own chrome and a transcription picker added. Keeping them apart meant
a scholar transcribing a manuscript moved between two pages to do one job, and
neither could show the text beside the leaf it was copied from.
`transcriptions.show` redirects here so old links still land somewhere.

The text pane is on the **left**, the manuscript on the **right**. The two are
not separable components: `hoveredRegionId`, `editableRegionId`,
`drawingActive` and the pending selection all cross between them, because
drawing a box on the image acts on the text selection. The page owns that
state; do not try to split it into two tidy components with a thin interface.

Which transcription and which layer are in the **URL** (`?transcription=&layer=`),
not in client state, because the server has to load that layer's segments,
regions and page breaks — so choosing one is a visit.

## The left pane is scoped to one page, and converts coordinates at five places
Everything in the component works in whole-text offsets; `AlignableText` is
handed the selected page's slice. `toFull`/`toPage` are the only conversions,
and there are exactly five: outbound `pageText`, `pageSegments`, `pageRegions`
and the selection props; inbound `onTextSelect`, `onBadgeClick` and `onEdit`.
Anything else added to that component keeps whole-text offsets. Getting this
wrong is silent — an edit would land at the wrong place in the text rather than
erroring.

A page runs from its own break to the next; with no breaks at all the pane
shows the whole text, which is what an undivided transcription should look
like. The image on the right follows the page on the left, and a page with no
photograph says so rather than showing another leaf.

## "Not placed yet" and "before the first page" are different things
An unplaced page shows the **whole text**, because placing it *is* choosing
where in the text it begins — there is nothing to narrow to yet. The stretch
before the first break is its own entry in the page row ("before 12r"), shown
only when text actually stands there.

Conflating them was a dead end, not a cosmetic slip: `pageEnd` fell back to the
first break for any unplaced page, so the moment one page was placed the pane
went empty for every other page, and no second page could ever be placed. The
first page worked, which is why building the UI before a test for placing the
*second* one hid it.
