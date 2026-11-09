# D5 (rights on images, the interface) and D7 (the guide): notes for PLAN-2 section 13

Built on 9 November 2026 by Claude Opus 5.5 in a worktree, for the lead to merge. The columns (`pages.rights`, `pages.attribution`, `pages.imageSource`, `witnesses.imageRights`, `witnesses.imageAttribution`, migration 0015), the core's list (`IMAGE_RIGHTS`, `normalizeRights`, `isCopyable`) and the archive's part (rights in `pages.json`, only copyable images copied) were there already; nothing under `archive/` or `packages/db/drizzle/` was changed, and no migration was added.

## Decided while building

### The server

- **One check for every write.** `parseImageRights` in `lib/server/pages.ts` checks what a form or caller gives: the statement through `normalizeRights` (so `http://creativecommons.org/...`, a trailing `deed.de` or a missing slash are accepted and stored in the listed form), the credit line trimmed to one line and at most 500 characters, the source empty or an http(s) address of at most 2000 characters. `attachUpload`, `addImagePage` and `updatePageRights` take the rights as a required argument and throw `PageError('invalid-rights')` before anything is stored, so no path can make an uploaded image without a statement; the form actions check first, to answer with the field's message.
- **Signatures.** `attachUpload(db, pageId, file, rights, storageRoot?, options?)` and `addImagePage(db, witnessId, label, file, rights, storageRoot?, options?)`: the rights come before the storage root. The only callers were the pages screen's actions and the tests.
- **The rights belong to the image.** A new upload replaces the page's statement, credit line and source with those given (an omitted credit line or source becomes empty, not the old one's). Moving an image to another page or shifting a run of images moves its rights with it; removing an image clears them. A page without an image has no statement.
- **Witness defaults** are stored by `setWitnessImageDefaults`; an empty statement means none. "Apply" gives the statement to the pages of the witness that have an image and no statement, and the default credit line only where such a page has none of its own (an import may have left one). Pages that already have a statement are never changed by it. The defaults are a section **Images** of their own on the witness's edit page, with their own action (`?/images`), rather than fields of the description form: the description form is shared with the form for new witnesses and with the identifiers branch, and the defaults matter only once there are images.
- **IIIF.** `parseManifest` reads `rights` (v3) and else `license` (v2, a string, an object with an id, or a list, of which the first is taken), and the value of `requiredStatement` (v3, by the usual language preference; its label is left aside) and else `attribution` (v2), at the manifest and on every canvas, regardless of the declared version (some manifests mix them). Markup in values is taken out and entities read (`plainText`). Statement and credit line are taken from the canvas each on its own, else from the manifest (`canvasRights`). A statement not in the list is not stored; one warning per distinct address goes into the preview's and the import's warnings, and the address becomes the credit line where there is no other. Where the manifest states no rights at all, the pages take the witness's default statement (and its credit line, when the manifest gives none); where it states an unlisted one, they do not, since the library has said something Varians cannot record. `imageSource` is the manifest's URL. Blank pages that take a canvas's image get the same.
- **The preview** carries the manifest's listed statement and label, an unlisted one, its credit line, how many canvases have a statement other than the manifest's, and the witness's default that pages would take.
- **Where the client gets the rights.** `PageView` (pages screen and Pages tab) has `rights`, `attribution`, `imageSource`; `WitnessPagesData.witness` and the workbench's witness have `imageDefaults`; the workbench's pages and the zones API's page rows (reader and editor) have `rights` and `attribution`.

### The interface

- **Upload forms** (Add images on the pages screen and the Pages tab) show the statement (preselected from the witness's default), the credit line (prefilled) and the source once files are chosen, and always without script. One choice applies to every file of the upload. Starting without a statement is refused in the browser with the same message the server gives.
- **One page's image.** The card's **Add an Image…** / **Replace Image…** and the card's **Add an image** button open a dialog with the file, the rights fields and, when zones are drawn on the image to be replaced, the warning about them (this replaces the separate confirmation dialog). The statement is preselected from the witness's default, else the page's own. An image **dropped** on a card, or dropped on or chosen in the empty facsimile pane, goes straight up with the witness's default statement and credit line when the witness has a default and no zones are at stake, as before; otherwise the same dialog opens with that file. This keeps dropping fast where the owner has said once what the images are, and asks where nothing has been said.
- **Per page**: the card's menu has **Rights of the Image…** (for pages with an image), a dialog with the three fields; a statement is required there too. The card shows the statement's label under the size, or *No rights statement* in the warning colour, so that the pages still to be given one can be seen at a glance.
- **The select** lists the statements of `IMAGE_RIGHTS` by their labels in the core's order, after an empty choice ("Choose a statement"; "None" for the witness default). When a statement that does not allow copying is chosen, the field's hint says that such an image is shown but not copied into archives or downloads.
- **The credit line under images** (`ImageCredit.svelte`): the credit line, a middle dot, and the statement's label linked to its address (`rel="license"`, a new tab, so that the workbench is not left). Shown under the workbench's facsimile pane, the reader's facsimile panel, the edition editor's witness pane in image mode, and the page viewer of the pages screen. Nothing is shown for an image with neither.

### Strings

- `pageStrings.rights`, `pageStrings.image` and the manifest's rights strings in `lib/strings/pages.ts`; the witness section's in `registry.witness` (`imagesSection` and the rest). `pageStrings.replaceImage` keeps only `zones`; its other strings went with the confirmation dialog.

### The guide (D7)

- A section **Licences and rights** before *Keyboard*, with *Publishing*, *The registry*, *Images* and *How to cite an edition*. *Pages and images* says how rights are given on upload, by the IIIF import, per page and by the witness's defaults. The transcript's *Settings* and the edition's former *Sources and licence* (now *Sources and rights*) speak of the **Note on rights**, with the licence named in the field's hint; the reader's list mentions the credit line under the facsimile and *About this edition* with **How to cite**.

## Left for later

- The public witness page does not show the images or their rights (it never showed the images); the page viewer on the pages screen and every image view do.
- The reader of a published transcript shows the credit line through the workbench's facsimile pane, which it uses read only.

## Deploy note

Nothing to run: no migration, no setting. Images uploaded before this have no rights statement; their cards say *No rights statement*, and the owner of each witness can give its default to all of them at once on the witness's edit page (**Images**, "Also give them to the … images that have no rights statement"). Until then they are shown, and not copied into archives, as the lead's archive change already does for images without a statement.
