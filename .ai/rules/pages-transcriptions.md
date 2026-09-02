---
paths:
  - 'resources/js/components/AlignableText.vue,resources/js/pages/Transcriptions/Editor.vue'
---

# Pages Transcriptions

## The text pane is ONE always-editable surface — no interaction modes
The old `'align' | 'assign' | 'edit'` mutually-exclusive `interactionMode` is
gone, deliberately (user-requested redesign): `AlignableText` is permanently
`:editable="canEdit"` on the witness page, selection is just selection, and
the toolbar's "Assign selection…"/"Map selection to facsimile" buttons act on
the remembered selection when *pressed* (`openSelectionMenu`) — a menu never
pops up from the act of selecting. `activeMenu` (`'align' | 'assign' | null`)
is the only surviving axis; a badge click still opens 'assign' directly. Do
not reintroduce modes.

The controlled-contenteditable mechanics stand: every mutating `beforeinput`
is `preventDefault()`-ed and translated into an exact `{start, end, text}` op
(via `getTargetRanges()` + `offsetAt()`), emitted up as `edit` with a
`source` (`'typing' | 'cut' | 'paste'`); chunks are freshly re-rendered
spans with no stable identity, so the component restores the caret via
`pointAt()` through `nextTick()`. IME composition runs unmanaged and resyncs
once at `compositionend`. Because `editable` is now always true, the guard
that keeps `beforeinput`/composition events from nested controls is
`originatesInControl()` (a `composedPath()` check for `[data-non-text]`) —
NOT the old `!props.editable` early-return. Badges are clickable while
editing and need `@mousedown.prevent` so the click doesn't move the caret
first; they keep `contenteditable="false"` + `data-non-text`.

**The witness page's selection menu renders OUTSIDE the contenteditable
element** (a sibling below the text pane), not through the
`#selection-menu` slot: form controls inside an editable region misbehave in
Firefox, and a native select popup even fires its closing mouseup on the
text underneath it, which dismissed the menu mid-use when it rendered
inline. The slot remains for read-only consumers (AddToEditionPanel), where
`editable` is false and none of this applies. If a slot consumer ever runs
editable, the slot wrapper carries `contenteditable="false"` — but prefer
rendering outside.

**Autosave, not Save**: `editOps` accumulate and flush on an ~800ms idle
debounce (`flushText`), single-flight, via the project's only Inertia partial
reload (`only: ['transcription', 'pageBreaks', 'flash']` — WitnessController::show
is far too heavy to re-run per keystroke). Sent ops are dropped from the log;
later ops' offsets are already in current-text coordinates. THE CENTRAL
INVARIANT the modes used to enforce by construction: **nothing that posts a
text offset may run with unsent ops** — `assignSelection`, `onRegionDrawn`,
`startPageHere`, `fixBoundaries` and `openLayer` all flush-then-act
(`flushText(true)`). A save rejected on the `ops` key is a concurrent-edit
conflict: autosave stops (`staleTextError`) and only `reloadAfterConflict`
(which also discards the op log and history) recovers; a `text`-keyed failure
is transiently invalid markup mid-typing — keep the ops, retry later, never
block. An op log with an outstanding (unpaired) cut is held back up to
`CUT_HOLD_MS` so the pair can reach the server in one request.

**Undo/redo** (`lib/editHistory.ts`): every op's inverse is recorded at apply
time; undo/redo are ordinary edit ops routed through the same pipeline, so
they preview and autosave like typing. Typing coalesces by ~750ms bursts;
cut, paste, import and each strip-marks batch are single atomic steps.
Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y are caught at **keydown** (`onContainerKeydown`)
— NOT via the `historyUndo`/`historyRedo` beforeinput types, which browsers
only fire when their native undo stack is non-empty, and ours never is
since every native mutation is prevented (real bug: Ctrl+Z was silently
dead). Cut/paste pairs are re-minted fresh `cut_id`s on every pass through
history, and because a pair's two halves live in SEPARATE history entries,
the re-mint is stateful (`openReMints`): the delete half opens a fresh id,
the matching insert half consumes it — independent minting left the halves
unpaired and the server tombstoned the citation an undo was restoring. The
autosave hold likewise keys on any unpaired delete-half in the op log (not
just clipboard cuts), so an undo's pair is never split across requests.

**Copy/cut own the clipboard** (`onCopy`/`onCut`): the browser's own
serialization of a selection includes the badges' visible text
("1.1the quick fox"), so a paste never exactly matched what a cut removed
and relocation silently failed whenever the selection covered a badge (real
bug). Both handlers put the PURE text — the characters the offsets
describe — on the clipboard; cut performs the deletion as a tagged edit op
itself (no `deleteByCut` beforeinput follows a prevented cut event).

An empty editable region needs a `v-if="editable && chunks.length === 0"`
real placeholder `<span data-non-text contenteditable="false">` — CSS
`:empty` does NOT work here since Vue's compiled `v-for` always leaves
comment-node fragment markers, which count as children and permanently defeat
`:empty` matching.

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
