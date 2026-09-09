# Edition page (resources/js/pages/Editions/Show.vue and its panels)

## Edition page: the two frames share one skeleton

The "Edition text" fieldset and the Witnesses fieldset (WitnessesPanel — the former add pane and manuscripts pane merged, user decision) are built to line up: `fieldset` + `legend`, then ONE `min-h-9` control row (`border-b pb-2`) — on the left the editing tools then the jump form, on the right the witness pulldown, layer toggles, "Add selection" and "Add lines…" — then the text box. There is no button row above the frames any more. Anything else — tool hints, the Add panel's "Add lines…" form — goes below the text box or in a slot that both sides fill (the left "remove" hint is the counterpart of the Add panel's action row, `min-h-[26px]`). Adding a row above the text box on one side only breaks the alignment the user asked for. The `Edition` fieldset above lists every visible witness citing the work (`witnesses` prop, `in_edition` flag), not only those the edition uses.

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
