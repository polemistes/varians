# Edition page (resources/js/pages/Editions/Show.vue and its panels)

## Edition page: the two frames share one skeleton

The "Edition text" fieldset and the Witnesses fieldset (WitnessesPanel — the former add pane and manuscripts pane merged, user decision) are built to line up: `fieldset` + `legend`, then ONE `min-h-9` control row (`border-b pb-2`) — on the left the editing tools then the jump form, on the right the witness pulldown, layer toggles, "Add selection" and "Add lines…" — then the text box. There is no button row above the frames any more. Anything else — tool hints, the Add panel's "Add lines…" form — goes below the text box or in a slot that both sides fill (the left "remove" hint is the counterpart of the Add panel's action row, `min-h-[26px]`). Adding a row above the text box on one side only breaks the alignment the user asked for. The `Edition` fieldset above lists every visible witness assigning text to the work (`witnesses` prop, `in_edition` flag), not only those the edition uses.

## Paratext mode, and the two display toggles (2026-09-13)
The control row's transposition button is called "Transposition" /
"Cancel transposition" (renamed from "Register transposition conjecture"
to make room — user decision); "Paratext" beside it opens PARATEXT MODE
(`paratextMode`, exclusive with registering): a box like the transposition
box holds the kind radios and, for Speaker indication, the edition-wide
speaker layout radios (saved at once through `editions.update`). In the
mode a character typed at the caret (`onTextKeydown` → `isTypingKey` →
`startParatextDraft`), a paste, or a dead-key composition
(`onTextCompositionStart/End` — the browser puts provisional text into a
word span no event can stop, so the caret is read at composition start
and the span's text is put back from the model at its end) opens a draft
paratext there: before the word at offset 0, after it otherwise, of the
kind chosen. `ParatextBox.vue` is the island (`contenteditable="false"`,
`data-non-text`) that shows a paratext or, while editing, a nested
editable field (a textarea for margins); Enter keeps, Escape discards,
blur keeps, empty removes. `ParatextEntry.vue` is a paratext's place in
the flow: always a zero-width ANCHOR (`data-paratext-anchor`) the page
measures (`measureParatexts`, after every update and on resize; changed
values only, or it would loop), then inline text, or for own-line
speaker layouts a `block` span followed by an inline-block SPACER as wide
as the text before the anchor (`indentOf`) so the interrupted line goes
on below, aligned with where it broke off. Margin notes render OUTSIDE
the flow as absolutely positioned boxes at the end of the text box
(`marginEntries`, `data-paratext-box`), top = the anchor's line top,
stacked down where two overlap (`stackMarginBoxes`); the box opens
`pl-36`/`pr-36` only while a margin note exists on that side. Whether a
point is a line BEGINNING (`isLineStart` in `lib/paratext.ts`) is the
edition's lineation — a piece's first run when the segment starts a line,
or a run with `break_before` — never wrapping. The Edition box's "Show
paratext" / "Show segment markers" checkboxes are the VIEWER's own,
kept per browser in localStorage (`varians:edition:{id}:display`); hiding
markers hides the number chips (and with them their notices). ALL THREE
are read from localStorage in `onMounted`, never at setup: the server
renders the defaults, and a first client render that already differs is
a hydration mismatch (real bug — a pane put away last time). "Show
witnesses pane" (same store) puts the right pane away for reader or
editor — the grid drops to one column and the edition has the whole
width for its text and margins. "Variants on hover" (same store) keeps
the apparatus tooltip away while the pointer moves over the words — a
click still opens the notice, and the word still lights its facsimile
box (`showReadings` sets `hoveredRun` and returns). "Wrap lines" is NOT
a viewer preference but the EDITION's (`editions.wraps_lines`): chosen
on the create form (`StoreEditionRequest`, default on) and changed in
"Edit edition properties" (the renamed title/description form, through
`editions.update`) — never in the display row: off, the text box gets `overflow-x-auto
whitespace-nowrap`, so lines run on as the editor set them and the box
scrolls sideways (user request — horizontal space is scarce); the anchor
measurement adds `scrollLeft`. A RIGHT-margin note is placed just past the
widest printed line (`textRightEdge`, measured over runs, chips and inline
paratext after each render), not at the box's right edge: at the edge it
sat on top of a line that reached it in no-wrap mode and too far from
the text when the witnesses pane was hidden (user report). Left-margin
notes stay in the left padding. Speaker indications are NOT capitalised
automatically (user decision) — the editor types them as they should
print. Verified in the browser for all three layouts on 2026-09-13.

## A word's popover is its own, plus the wider readings covering it (2026-09-09)

`toggleRun` opens the clicked run itself — never a redirect to an earlier
anchor. `popoverCandidates` lists the run's own candidates first, then every
unselected range candidate from an earlier run that reaches this far (a
witness's omission of several words, an unadopted range conjecture, a
witness's phrase against several columns), each carrying the `anchorRun`
it is actually picked at. The old redirect hid a word's own candidates —
a deletion registered on one word inside R2's omission span was
unreachable. Every unselected row has an explicit "Adopt" button for
editors: a reading that reads "omitted" or "deleted" does not look like a
control. The omission marker `‸` has a widened hit area for the same
reason. `coveringAnchorIndex` still drives site highlighting and hover.

Witnesses that read the same are one popover row, "R, R2: …"
(`groupWitnesses`, user decision 2026-09-09): grouped by anchor column,
range end and NFC wording (omissions together); the row's pick is the
selected member, else the base's, else the first. Conjectures are never
grouped. The popover shows normalized wording only — no diplomatic
spelling beside a candidate (user decision): grouping is by the normalized
layer, and a spelling next to a grouped row would misstate what grouped
it. "As written" lives in the hover apparatus alone.
