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
once at `compositionend`.

**The caret must survive EVERY re-render, not just edit-driven ones**
(`onBeforeUpdate`/`onUpdated` in AlignableText): any patch can replace the
text node under the caret, and Firefox dumps a caret whose node vanished to
the start of the surface. The visible case was Enter — the newline saved,
the autosave partial reload's patch regrouped the line nodes, and the caret
jumped to an earlier line one autosave after every line break (real bug).
The pre-patch live caret offset is captured in `onBeforeUpdate` and put
back in `onUpdated` if the patch displaced it; an edit's own
`applyAndRestoreCaret` nextTick restore runs after `onUpdated` and wins, so
the two don't fight. Capture is gated on the surface being focused (a
background pane's re-render must not steal the caret — restoring focuses)
and on a COLLAPSED selection (clobbered range selections belong to the
remembered-selection machinery). Do NOT move this into a save callback:
Inertia's `onSuccess` fires after the DOM patch, when the caret is already
clobbered and its offset unrecoverable (tried; failed). Because `editable` is now always true, the guard
that keeps `beforeinput`/composition events from nested controls is
`originatesInControl()` (a `composedPath()` check for `[data-non-text]`) —
NOT the old `!props.editable` early-return. Badges are clickable while
editing and need `@mousedown.prevent` so the click doesn't move the caret
first; they keep `contenteditable="false"` + `data-non-text`.

**All selection actions render OUTSIDE the text surface** — the
`#selection-menu` slot is gone entirely (its last consumer,
AddToEditionPanel, now uses the same pattern as the witness toolbar: a
remembered selection plus an "Add selection" button above the pane). Menus
inside the surface were repeatedly broken: form controls inside an editable
region misbehave in Firefox, a native select popup fires its closing
mouseup on the text underneath and dismissed the menu mid-use, and an empty
block wrapper forced a stray line break after every selection. Do not
reintroduce in-surface menus or the slot.

**Autosave, not Save**: `editOps` accumulate and flush on an ~800ms idle
debounce (`flushText`), single-flight, via the project's only Inertia partial
reload (`only: ['transcription', 'pageBreaks', 'layerCorrespondence', 'flash']` — WitnessController::show
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
unpaired and the server tombstoned the citation an undo was restoring.
An insert half with NO open re-mint keeps its ORIGINAL id: that is the
undo of a LONE cut, whose other half is the original cut op still sitting
unsaved in the log under that very id (the unpaired-cut hold keeps it
there) — a fresh mint here paired with nothing, and undoing an accidental
Ctrl+X collapsed every citation the cut covered (second real bug in this
family). Server-side, `normalizeOps` additionally re-pairs by CONTENT: an
insert claiming relocation under an id no cut in the request recorded
adopts the first outstanding cut whose removed text matches exactly
(`adoptOutstandingCut`, test-pinned) — both halves declared relocation
intent, so old mis-paired logs land safely instead of tombstoning. The
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

## The right pane is a toggle: manuscript leaf, or the sibling layer
When both layers have text, `rightView` switches the witness page's right
column between the image viewer and a read-only, page-scoped rendering of
the OTHER layer (`layerCorrespondence.text` — the same prop that feeds the
in-step indicator), with the diverging line marked amber. It is the
recovery path when the layers drift: fix whichever side is wrong while
seeing both. Page scoping reuses the shared line-number breaks resolved
against the sibling's own text. Arming region drawing forces `rightView`
back to `'image'` — the drawing target is the leaf.

## The workbench is two symmetric panes with the Pages box between
`Witnesses/Show.vue` is now a thin shell: the Witness box, two panes, and
the shared Pages fieldset between them. The ENTIRE transcript editor —
op log, autosave, undo history, selection, floating actions, import, copy,
visibility, strip-from-selection — lives in
`components/TranscriptPane.vue`, instantiated once per pane, each instance
owning its own autosave loop and history. The facsimile side is
`components/FacsimilePane.vue`. The SIDES ARE FIXED (user decision,
revising the earlier any-layer-anywhere model): diplomatic is always the
left pane, normalized always the right, tabs labeled "Diplomatic
transcript"/"Normalized transcript" plus "Facsimile" on each side. The URL
carries the TRANSCRIPT (`?transcript=12`; legacy `?transcription=`,
`?layer=` and `?left=layer-N`/`?right=layer-N` map to the layer's
transcript, test-pinned) and each pane's labeled "Choose transcript"
select switches transcripts — never layers — for both panes at once. The
same-layer-twice clash cannot arise any more, and the "every layer is
already open" dead-end message it produced is gone with it. Showing the
facsimile is CLIENT-side tab state (its data is already on the page);
choosing a transcript is a visit.

**The selection actions FLOAT under the selection's last line** — an
absolutely positioned sibling of the editable surface inside a relative
wrapper, anchored from the live selection's client rects
(`updateSelectionAnchor`), recomputed after each edit. Nothing is ever
inserted into the text flow, so no line ever breaks for it (the old
in-flow menu bug class). The assign/align menus open inside that same
overlay. Strip buttons act on the SELECTION only (`stripFromSelection`),
and undo/redo sit right-aligned on the strip row.

**Cross-pane drawing**: a transcript pane arms (`arm-drawing` after
flushing), the page flips the OTHER pane to its facsimile tab, the
facsimile emits the drawn box, and the page routes it back to the arming
pane's exposed `completeRegion` — the editor owns the selection, the
granularity, the flush and the error display, always. Page placement
("Start X at selection") lives in the Pages box and calls the selecting
pane's exposed `placePage`.

Autosave partial reloads now request `only: ['leftPane', 'rightPane',
'flash']` — both panes, because a mirrored relocation changes the sibling
layer, which may be open opposite. User-visible language says
"transcript"; the internal rename from "transcription" is a separate,
purely mechanical pass still to come.

## A cross-layer clipboard COPY carries its spans
`onCopy` in AlignableText emits `copied` alongside owning the clipboard;
the pane stashes `{layerId, start, end, text}` at module scope
(`lib/transcriptClipboard.ts`). A paste whose text exactly matches the
stash, into a DIFFERENT layer, emits `import-spans`; the page flushes both
panes (offsets must be into saved text on both sides), then posts
`transcriptions.span-copies.store`, which re-verifies the characters match
at both ends before importing. Assigned ONCE also on import: a copied
segment is skipped when the landing words already carry a live assignment
to the same passage — the sibling-healing pass restores assignments the
moment a pasted text saves, and the import arriving after it duplicated
every one as a second part (real bug: badges all read 1/2). User-visible
wording is "assignment(s)" and "image mapping(s)", never "citation(s)"
(user decision). Layer-scoped flash notices carry `message_layer_id`
(shared as `flash.layer`); a pane shows `flash.message` only when the id
is absent or its own — both panes render the shared flash, and an import
notice repeated over the sibling pane read as a report about the
sibling's own layer.

**The `import-spans` emit MUST come after the paste op joins `editOps`**
(end of `applyEdit`, not inside the paste-matching branch): the handler's
first act is `flushBoth()`, which runs synchronously during the emit — an
emit before the push finds an empty op log, "flushes" instantly, and the
import posts against text the server hasn't seen, so its match guard
refuses everything (real bug: citations never followed a cross-witness
copy; the tell in the network log is span-copies BEFORE the text PATCH).
`flushBoth` resolves whether both panes saved clean and `onImportSpans`
bails when they didn't. A genuine mismatch at the server is a flash
NOTICE, not a validation error — the paste itself succeeded, and the one
consequence the editor can't see is that nothing came along; the silent
error-bag version hid exactly this bug. The import also assigns each
created row a fresh `group_id` and runs `SiblingSync::heal` on the target,
so an in-step target transcript receives the citation in BOTH its layers
(test-pinned). Citations travel ALWAYS — cross-layer,
cross-transcript, cross-witness — and a segment the copy cuts through
contributes its contained part (still genuine text of its passage, as a
further part where the target already cites it, unflagged). Facsimile
mappings are facts about one parchment: whole-span-only, same witness
only, skipped where the target already maps overlapping text. Cut stays
relocation within a layer; cross-layer cut does not carry (the source
spans are tombstoned by the deletion before the import could read them).
NOTE: for the two layers of ONE transcript this whole mechanism is interim
— the agreed destination is spans stored once per transcript in word
coordinates, projected per layer (see the plan in the repo history).
