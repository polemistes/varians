---
paths:
  - 'app/Support/Bibliography/**'
  - 'app/Models/{BibliographyItem,BibliographyReference}.php'
  - app/Http/Controllers/BibliographyItemController.php
  - 'app/Http/Requests/*BibliographyItemRequest.php'
  - resources/js/lib/biblatex.ts
  - resources/js/components/BibliographyItemForm.vue
  - 'resources/js/pages/Bibliography/**'
---

# Bibliography

## The list IS biblatex — one registry, stored verbatim, exported as .bib
`BibliographyItem` holds one biblatex entry: `entry_type` (the `@type`),
`citation_key`, and `fields` as a JSON map of biblatex field name to value
in biblatex's own conventions (names "Last, First and Last, First", dates
ISO 8601-2, page ranges "45--67"). `App\Support\Bibliography\Biblatex` is
the ONE registry of types, fields (with kind and picker group) and the
standard fields shown per type; the client gets it as the `registry` prop
and mirrors nothing (`lib/biblatex.ts` only parses/serializes name lists
and previews an entry). Validation refuses any field name not in the
registry and any value with unbalanced braces; a title is required (user
decision: the interface stays lean, but must be able to record every
biblatex field — "Add field…" lists the rest, grouped).

`label` is derived on save (`CitationLabel`: author–year, two authors
joined, three or more "et al.", editor/translator/corporate body as
fallbacks, a letter suffix among items sharing the base) and stored for
sorting and search; `citation_key` is generated from it when omitted and
must stay unique. `ReferenceFormatter` prints a plain author–year
reference as italic/plain runs — enough to read, not a CSL engine; every
field it ignores is still in the export (`BiblatexWriter`,
`bibliography.export`).

## References cite from exactly one place; items are never deleted under them
`BibliographyReference` targets a conjecture (`conjecture_id`) OR a passage
of one edition (`edition_id` + `canonical_passage_id`, keyed like
EditionComment — never through EditionPassage, so removing and re-adding a
passage keeps its literature), with biblatex's `prenote`/`postnote`
("cf.", "pp. 45–47") and a `position`. The item FK RESTRICTS: an item
anything cites cannot be deleted (`BibliographyItemController::destroy`
lists what cites it). The list is readable by everyone (page and .bib);
every member adds to it, and a member may change or remove only an item nobody else relies on — one she added that nothing cites, or one cited solely by her own editions and conjectures; site-wide editors may change any item (`BibliographyItemPolicy`, user decision). An import with `replace` skips the keys she may not change.

## Spellings converge by suggestion, never by refusal
`Suggestions::all()` collects what the list already records — every
name-list field's family/given pairs, publishers and places (split on
"and"), journals and series — and the page ships it as `suggestions`; the
item form offers them through `<datalist>`s. Persons are ONE suggestion,
"Family, Given" on BOTH name inputs (user decision: family first even
in the given-name box; browsers match a datalist on any part of the value,
so typing "Ulrich" still finds Wilamowitz), and choosing one fills both
boxes
(user decision: separate family and given lists could not stop
"U. Wilamowitz", "Ulrich Wilamowitz" and "U. Wilamowitz-Moellendorff"
becoming three people). Nothing is enforced (user decision): a new author or press
is exactly what a new item may bring, and a datalist still accepts any
text. Any form that embeds `BibliographyItemForm` must pass `suggestions`
or the nudge silently disappears.

## Citing: one picker, two modes; a new conjecture arrives cited
`ReferencePicker.vue` is the only way anything cites. DRAFT mode
(`v-model` of `DraftReference[]`) serves things not yet recorded — the
substitution/lacuna/supplement/whole-line-lacuna popovers and the order
proposal — and the citations travel in that thing's own request
(`conjecture_references` on edition-variants.store, `references` on
conjectures.store / conjecture-orderings.store; rules in
`ReferenceRules`, rows written by `ReferenceAttacher`), so a conjecture is
never created uncited. LIVE mode (`target` = `{conjecture_id}` or
`{edition_id, canonical_passage_id}` plus the current `references`) saves
at once through `bibliography-references.*`, as notes do — used for a
passage's References section in the line notice and for editing an
adopted transposition's record. The typeahead is `bibliography.search`
(JSON, editors). "+ New item…" embeds `BibliographyItemForm`; the store
flashes `created_bibliography_item_id`, `HandleInertiaRequests` resolves it
to `flash.created_bibliography_item`, and ONLY the picker that opened the
form (`awaitingCreated`) attaches it. Every embedding page must ship
`bibliographyForm` (registry + suggestions) — the edition page does.

Display: candidates, unplaced conjectures and adoptions carry
`references` (`EditionController::citations`: id, item_id, label,
citation, pre/postnote) and the page prints them as "(Bergk 1882, 45;
Dover 1972)" beside the proposer, in the popover and the hover apparatus.
The free-text `conjectures.bibliography` column is gone (user decision:
nothing in it was worth converting, and a text field beside structured
citations invites two spellings of one work). `bibliography` (`EditionController::bibliography`) is every
item cited by a passage of the edition or by a conjecture with a reading
on one of its passages, formatted, anchored `#bibliography-{id}` at the
foot of the page. A line with references opens the notes notice and
takes the sky chip, like a line with notes.

## .bib in and out
`BiblatexWriter` exports the whole list (`bibliography.export`) and one
edition's citations (`editions.bibliography.export`, via
`EditionBibliography::itemIds`, the same set the page's Bibliography
section prints). `BiblatexReader` imports (`bibliography.import`, pasted
text or an uploaded file): a hand-written parser for braced/quoted/bare
values, `#` concatenation, `@string` macros and `@comment`/`@preamble`
blocks; BibTeX aliases map onto biblatex (`phdthesis` → `thesis` +
`type`, `journal` → `journaltitle`, `address` → `location`, `school` →
`institution`); fields outside the registry are DROPPED and reported, an
entry without a title or with an unusable key is skipped and reported,
never fatal. A key already in the list is skipped unless `replace` is
set, in which case the item under that key is updated in place (its
citations stay — same work). The report is `flash.message`. No parser
dependency was added (user approval would be needed); the reader covers
the standard shape and says what it could not read.
