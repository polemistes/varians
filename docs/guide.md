# Using Varians

This guide is for editors: the people who transcribe witnesses, collate them and make editions in Varians. It follows the work in the order it is usually done. [PLAN.md](../PLAN.md) explains why things are as they are; this guide only says how to use them.

## The parts of Varians

- A **work** is a text as an abstract object: the Iliad, Plato's Symposium. It exists once in Varians and is shared by everyone. It has a **reference scheme**, the way its passages are numbered (book and line, Stephanus page and section), and its numbered passages are its **segments**, such as 1.5.
- A **witness** is a physical carrier of the text: a manuscript, a papyrus, an inscription, a printed edition. It too exists once, with its **pages** and their images.
- A **transcript** is one person's transcription of a witness. It belongs to that person.
- An **edition** is a critical text of a work, made by comparing transcripts. It belongs to its editor.
- A **conjecture** is a proposed reading. It belongs to the work, so that every edition of the work can use it.

Works, witnesses and the bibliography form a shared **registry**: before you add something, Varians shows what already exists, so that the Venetus A is entered once and used by everyone. Whoever adds an entry **maintains** it and decides who else does; maintainers edit its details, and any of them may step down. Using an entry needs no permission.

## Finding your way

The **front page** shows visitors what Varians is and the recently published editions. Signed in, it offers the ways in: **Read Edition**, **Register Work**, **Register Witness**, **Transcribe Witness** and **Make Edition**; under **Continue** are your most recent editions and transcripts, so that one click takes you back into them.

The header leads everywhere else: **Your Work** (all your editions and transcripts, and what others share with you), **Editions** (everything published, to read), **Works** and **Witnesses** (the registry), and **Bibliography**. **Search:** in the header is the one search: it finds published editions, works, witnesses and bibliography entries at once. This guide is at **Guide** in the footer of every page.

**Make Edition** asks which work, then leads to the new edition's form. **Transcribe Witness** asks which witness, then opens its form for a new transcript.

## Your account

**Register** in the header makes an account. Where the installation sends mail, a link to confirm the address is sent first, valid for a day, and the account can be used once the address is confirmed; logging in before then sends a new link. **Forgotten your password?** on the login page sends a link to set a new one, valid for an hour; where the installation sends no mail, its administrator gives you such a link. Setting a new password ends every other session of the account.

The footer of every page names the version of Varians that runs the site and links its source code.

## A work

Choose **New work** on the **Works** page, or **Register Work** on the front page. As you type the title, works with a similar title or author are shown; if yours is among them, open it instead of making a second one.

- **Language** sets how words are normalized and compared when witnesses are collated (see *Diplomatic and normalized* under Transcribing). For Latin, u and v count as one letter; for Hebrew and Arabic, the vowel points are left aside.
- **Identifier** is optional: the work's CTS URN, such as urn:cts:greekLit:tlg0012.tlg001. Passages of the work are cited by it in the TEI.
- **Identifiers** lists further canonical identifiers, each a scheme and a value: a CTS URN, Diktyon, Trismegistos, Wikidata (Q8275), VIAF, a URL, or Other. Each value is checked against the form of its scheme. They are shown on the work's page, linked where the scheme has a resolver, and the search finds the work by any of them, so that pasting Q8275 finds the Iliad. An archive brought in from another installation is matched to the work here by its identifiers before a new work is made.
- **Visibility** is public by default. A private work is visible only to its maintainers and to the editors of its editions.
- **Reference scheme**: choose a common one (book and line, chapter and verse, Stephanus page and section) or describe your own levels. An example label shows how passages will be written.

The work's page lists its editions, the witnesses transcribed for it with how much of the work each covers, its conjectures and reported readings, its segments, and its archive. Maintainers change the details, the scheme and the maintainers under **Edit**.

### Merging two works

When a work has been registered twice, the duplicate is merged into the other under **Edit**, **Merge into…**: find the surviving work by title, author or identifier, and Varians shows what will move and what prevents the merge. Segments are matched by their address: the duplicate's 1.5 and the survivor's 1.5 become one segment, and everything that named the duplicate's (the text of its transcripts and editions, conjectures, reported readings, notes, citations) names the survivor's; segments the survivor lacks move to it, labelled in its scheme. The editions, conjectures, reported readings, transcripts and maintainers of the duplicate go to the survivor with them. Two works whose reference schemes have different levels cannot be merged, since their segments cannot be matched. The survivor keeps its title, description, visibility and scheme, and gains the duplicate's identifiers; its page lists the works merged into it. The duplicate's address and identifiers lead to the survivor from then on, also in archives brought in later. Moving a segment within a transcript or an edition is not a change of its text and is not recorded in its history. Administrators and those who maintain both works may merge them, and a merge cannot be undone.

### Conjectures and reported readings

The work's page keeps the catalogue of conjectures. **Add conjecture** asks for the segment (such as 1.5), the kind (substitution, deletion, addition, lacuna, supplement, transposition), the words it concerns, the reading, the scholar who proposed it, the works where it was proposed, and a note. A conjecture starts as a draft that only you and the editors you work with see. Tick **Published** to make it part of the shared catalogue; publishing an edition does this for your conjectures on its work.

A **reported reading** is what a witness is said to have at a place, by another edition's apparatus or a collation, without a transcript of that witness. It enters the apparatus under the witness's siglum, with its source.

## A witness

Choose **New witness** on the **Witnesses** page, or **Transcribe a witness** on a work's page and then **New witness**. Every field but the name and the siglum is optional: repository, place, shelfmark, identifier (a catalogue number), identifiers, date, material (from a list, or **Other** with a word of your own), extent, hands, provenance and a description. **Hands** is a list: each hand has a label as the catalogues cite it (m1, m2, A²) and a description, and one of them is marked as the scribe of the text. Corrections in the transcripts of the witness can then name the hand that made them (see *Features* under Transcribing). The siglum given here is a default; each edition gives the witness its own.

**Identifiers** are canonical identifiers of the witness, each a scheme and a value, as for a work: a Diktyon number for a Greek manuscript, a Trismegistos number for a papyrus, a Wikidata item, a URL. The witness's page links them to Pinakes, Trismegistos and Wikidata, and the search finds the witness by any of them: pasting a Diktyon number finds the manuscript.

The **category** says what the carrier is: a manuscript, an inscription, a printed edition, an indirect source (a text quoting or reporting this one), or something else. A papyrus is a manuscript: give papyrus as its material. For a manuscript, the **format** says whether it is a codex, a roll or a single sheet, or that this is not known; a roll's pages are best labelled as columns, col. i, col. ii. For an indirect source, give the author and the work that quote the text, such as Athenaeus, Deipnosophistae; the passage goes with each reading reported from it. A witness that survives in pieces has its fragments as pages, labelled as you cite them (fr. 1, fr. 2 verso).

Whether a witness has all of a text or only part of it is a matter of the work, since one codex may hold all of one text and part of another. The work's page shows it for each witness, as complete or partial, from the passages its transcript covers.

The witness's page shows its pages, its transcripts and the works they belong to. **New transcript** asks for a name, the work it is for, whether to keep a diplomatic form beside the normalized one, and optionally another transcript to start from.

### Merging two witnesses

A witness registered twice is merged into the other under **Edit**, **Merge into…**, as works are. Its transcripts, reported readings, sigla in the conspectus of editions, maintainers and pages go to the surviving witness, the pages after the survivor's own, with the hands and identifiers the survivor lacks. Two things prevent the merge until they are resolved: an edition whose conspectus names both witnesses (remove one of them from it), and a page label both witnesses have (rename, move or delete one of the pages). The survivor keeps its description and siglum; its page lists the witnesses merged into it, and the merged witness's address leads to it. Administrators and those who maintain both witnesses may merge them, and a merge cannot be undone.

### Pages and images

The pages of a witness are managed in two places, with the same means: on the **Pages** tab of the side pane while transcribing (see below), and under **Manage pages** on the witness's page. Both are for the maintainers of the witness; everyone else sees the pages.

- **Add images** takes several image files at once, one page per file, in the order of the file names. The labels come from the file names, or continue the sequence of the last page (12r, 12v, 13r). Large files show their progress; the image is tiled for fast zooming.
- **Add pages** makes pages without images from a range such as 1r-12v, 1-20, p. 1-20 or col. i-iv, or from a list. Images can be added to them later.
- **Import IIIF manifest** takes the pages of a manuscript published by a library, with their images, which stay on the library's server. A preview shows what will be imported. Import only the pages not yet there, or replace the pages nothing refers to. The manifest's address is kept on the witness and shown on its page.

Every page is a card with its image, its label and its number. A page without an image says so, and **Add an image** on the card takes one. An image file dropped on any card becomes that page's image, in place of the one it had. The card's menu (**⋯**) renames the page, moves it up, down or to a position, adds, replaces or removes its image, and removes the page. The menus of Varians use capitals as English menus do (**Move Up**, **Remove Page**); buttons and labels do not. Click the label to rename it in place.

**Move Image to Another Page…** in the menu is for an image that was given to the wrong page: choose the page it belongs to, and the image goes there; when that page has an image of its own, the two change places. The next page is proposed, which is where an image most often belongs when the pages were counted wrong. Mapped words (zones) stay with their page, as they do when an image is replaced, and show on whatever image the page then has.

**Shift Images from Here…** mends a whole run of images that is one page out, as happens when a page was missed or counted twice while scanning. Open it on the first page that is wrong and choose a direction:

- **One page later**, for images that began one page too early: this page and every page after it take the image of the page before them. When the last page has an image, a new page is added at the end for it, labelled after the last one (2v is followed by 3r).
- **One page earlier**, for images that began one page too late: the page before this one takes this page's image, and so on to the end. The page before must have no image of its own.

Pages without an image within the run keep their place in it, so a gap moves along with the images. Zones stay with their pages here too.

A page that a transcript or a mapped word refers to is not removed without asking.

## Transcribing

A transcript is a stretch of a witness as you transcribe it: usually one work's text, sometimes a whole manuscript running through several works. You may make as many transcripts of a witness as you like, also of the same work: two readings of a damaged papyrus, or a copy to try something on. An edition always says which transcript stands behind each siglum.

A transcript is **for** one or more works, chosen when you make it and changed under **Settings…**. The first of them gives the defaults: which work's segment labels are offered, and which spelling rules propose normalized forms for text not yet assigned to a work. Text you assign to a work's segments belongs to that work whether it is chosen here or not, and each stretch is read by its own work's spelling rules, so a Greek text and a Latin one in the same manuscript are each treated right. A transcript is listed on the page of every work it is for or has text of. One with text of a private work is seen only by those who may see that work.

A transcript opens in the workbench: the text on the left, one page at a time, and on the right the facsimile of that page, the other form of the text, its history, or the pages of the witness. The status line at the foot says whether your work is saved, how many lines the page has, how many words are not yet mapped to the image, and how many words have a normalized form still to check.

### Bringing a text in

Often there is already a text to start from: an earlier edition, a text from the web. **Import…** in the **⋯** menu takes:

- **TEI**: a file, a web address, or a CTS URN such as `urn:cts:greekLit:tlg0012.tlg001.perseus-grc2:1.1-1.10`. Varians reads the structure it finds (books, lines, chapters) and proposes how its numbering maps onto the work's segments; you can correct the mapping before importing.
- **Plain text**, with the numbering it finds at the starts of lines or in brackets.
- **Leiden** conventions, as epigraphers and papyrologists write them.
- **PAGE or ALTO**, the formats of text recognition programs, with the position of every word on the image.

An import into an empty transcript becomes its text; otherwise it is added after the last line, or replaces the whole text if you ask. Either way it is one change in the history. Most imports are only a starting point for transcribing the witness, and then their source does not matter; where it does, give it under **Source to record**, and it is added to the transcript's sources.

Another transcript can also be the starting point: choose it under **Start from another transcript** when you make a new one, and correct the copy against your witness.

**Make a Copy…** in the **⋯** menu copies the transcript you are looking at, yours or a published one of someone else's: a draft of your own with the text, the works, the settings, the remembered normalized forms and the boxes on the images. Its history starts afresh and says where it came from.

### Typing

Type as in any editor. Enter starts a new line. The arrows beside the page label move between pages, and **Whole text** shows every page at once.

**Pages…** in the same list, or the **Pages** tab of the side pane, shows every page of the witness as a card with its image, the page shown marked; click a card to go to that page. If you maintain the witness, this is also where its pages are managed while you transcribe: add images and pages, import a manifest, and use each card's menu, as described under [Pages and images](#pages-and-images). When the page shown has no image yet, the **Facsimile** pane offers **Add an image…**, and an image file can be dropped there.

### Pages, columns and paragraphs

Put the caret anywhere in the line that begins the new page, column or paragraph; nothing needs to be selected. Open **Insert** at the top and choose **Page break**, **Column break** or **Paragraph break**. The break always goes before the caret's line, wherever in the line the caret stands. While the menu is open, a dashed rule in the text shows where it will go, and each choice says what it does ("Line 4 will begin 13v"). Ctrl+Shift+P makes a page break the same way without the menu.

A new page break takes the next page of the witness that has no break yet, and shows as a rule with that page's label. To choose another page, use **Begin … with the caret's line** in the page list. To begin a page in the middle of a line, press Enter there first, then make the break on the new line. A line that already begins a page keeps its page break. Ctrl+Z takes a break away again.

**Insert** also puts a gap, a blank space, a figure or a note at the caret.

A word divided at the end of a line is joined across the line break: type a hyphen and Enter where the scribe divided it, and Varians keeps the two parts as one word.

### Diplomatic and normalized

Every word of a transcript has a **normalized** form: the word as it is read, in the spelling the edition uses. A transcript can also keep a **diplomatic** form of every word: letter for letter as the witness writes it, with its capitals, its spelling and its accents or their absence. Choose **Keep a diplomatic form beside the normalized** when you make the transcript, or later under **Settings…**; without it the transcript is normalized only. The **Diplomatic** and **Normalized** switch at the top shows one text or the other for editing; the side pane can show the other beside it.

- Varians proposes normalized forms from the language of the work each stretch belongs to: capitals lowered, final sigma, abbreviations expanded where you marked their expansion. **Normalized forms proposed** in the status line lists the proposals; accept them all or some. It never adds accents or breathings.
- Every normalized form you type or accept is remembered for this transcript, and proposed again for the same diplomatic form.
- A word whose diplomatic form changes after its normalized form was set is marked faintly until you **Confirm** it. Where the two agree apart from letter case and accents, it is confirmed by itself.
- Features can be marked on single letters of the diplomatic form (an unclear letter, a supplied one); the normalized form is always the whole word.

**What the apparatus reports.** The apparatus reports different words, never different ways of writing them. Collation compares the normalized texts only, as you type them, without regard to letter case; the diplomatic texts play no part. Whatever differs between a witness's diplomatic and normalized forms is therefore normalization: the scribe's spelling, iotacism, abbreviation, accents written otherwise than the word you read requires. Where two witnesses' normalized forms differ, also only in an accent, a breathing or a punctuation mark (ἦ, ἤ), that is a variant. So give a word a different accentuation, or a passage a different punctuation, from the other witnesses only where its manuscript gives reason to. A grave counts as an acute, since it only marks the word's place before another, and the marks of elision count as one. How a witness writes its words is its diplomatic text, which readers can see beside the edition (see *The reader*).

**Textual and interpretative variants.** A variant is *textual* where the witnesses have different letters: other words, or the same words in another order. It is *interpretative* where they have the same letters read otherwise: in accents, breathings, punctuation or word division (ὅτι, ὅ τι). An archetype in capitals, without accents or spaces, could not tell those apart, so they record the history of the text's interpretation rather than of the text. Varians sorts each place by its letters: an iota subscript or a diaeresis counts as a letter, and a lacuna tells nothing, so a place where only a lacuna differs is textual. The edition's editors can call any place the other kind (see *Adopting readings*), and decide how the edition prints the interpretative ones.

**Switching.** The diplomatic form can be turned on and off under **Settings…**, each time as one change in the history:

- Turning it on, every word's text as it stands becomes its normalized form, and its diplomatic form starts as a copy. Correct the diplomatic text to what the witness has; the normalized forms stay as they were. Nothing is lost.
- Turning it off keeps the normalized text only. The diplomatic forms leave the current text but stay in its history; features marked on single letters then cover the whole word. Turning it on again copies the normalized text once more: to get old diplomatic forms back, go back in the history.

**Tools** in the workbench bar helps with the two texts, and does nothing until you ask. Each tool acts on the selected words, or on every word of the page when nothing is selected, and each is one change that Ctrl+Z undoes:

- **Normalize diacritics** gives the normalized forms their accents, breathings and diaereses from the analyser of Greek forms (see *Sources and licences*). Where the letters can be only one word form, it is set, accented for its place (a grave before another word, unless punctuation follows). Where the witness writes accents or breathings, only the forms that agree with them are considered, and a form you chose before for the same diplomatic word comes first. The remaining words are marked: with the caret on one, a list shows the forms it can be, each with its lemma and grammar; click one (or press Alt and its number), or **Leave as it is**. The status line counts the words left to choose and steps from one to the next. Words the analyser does not know are marked in red: type them.
- **Take normalized forms from another text…** aligns the words with another transcript or an edition of the same work, as collation does, and where a word has the same letters as the word it stands against, gives it that text's normalized form, accented for its place here. Words with other letters are textual variants and are left as they are.
- **Remove from the diplomatic text**: accents, breathings, diaereses or iota subscripts, each by itself, or all four. Useful for a diplomatic text started as a copy of a normalized one.
- **All lower case** and **All upper case** change the case of the text shown. Case means nothing in the manuscripts; this is only how you prefer to present the text.

Text without word division, as in many manuscripts and inscriptions, is typed with spaces between words. **Diplomatic, without word division** in the side pane shows it as the witness has it.

### Features

Select some words or letters and the small toolbar under the selection offers the features of the text, named as TEI names them: unclear, supplied, deleted, added, abbreviation, and others. Each also has a shortcut (see below). Features are kept exactly, and come out in the TEI export.

A deletion or an addition is a correction, and **Correction…** in the same toolbar says who made it and when: the **hand**, chosen from the hands registered on the witness, or the scribe, or another hand, or not known; and the **stage**, a number for the layer of correction (1 for the first, 2 for the next), when the stages can be told apart. Both may stay unknown. What is recorded here is what an edition can collate: the witness as first written, after all corrections, after a given stage, or with the corrections of one hand (see *Making one* under The edition). A correction that changes only the spelling shows in the diplomatic text and in the TEI but makes no entry in the apparatus, since the apparatus compares normalized forms.

A reading the manuscript itself offers as an alternative, written in the margin or between the lines (often introduced by γρ.), is entered on the words it concerns: select them and choose **Variant…**, type the variant's words (nothing, if the variant leaves the words out), and say where it stands and, if you know it, in which hand. The words are underlined faintly with a small "v.l." after them. **Edit variant…** and **Remove variant** change or take it off again. Such variants stay part of the same witness; an edition can compare them as a text of their own (see below).

### Segments

The gutter at the left shows where segments begin: the work's labels, such as 1.5. Click a line's gutter, or press Ctrl+Shift+L, to set the label of the segment that begins there; the next label is proposed. A segment can begin in the middle of a line, and a text can leave the work for a while: **Unassigned from here**. **Number Lines from Here…** labels every following line of the page at once, as verse needs.

### Mapping words to the image

The line between the text and the side pane can be dragged, to give the image or the text more room. In the **Facsimile** pane, the words you select or point at in the text light up on the image (the caret alone lights nothing), and pointing at a mapped region shows its box and lights its words in the text. Other boxes are not drawn, so the page stays readable; **Show all boxes** draws them all, and your browser remembers the choice.

- **Map lines**: select several whole lines in the text, then draw one box around them on the image. Varians finds the lines in the box and divides each into word boxes by the length of the words; correct them as described below.
- **Map selection**: select words, then draw a rectangle or polygon around them.
- **Feature**: with no words selected, a shape marks something on the page that is not text: a figure, damage, a marginal mark.
- **Delete** removes boxes: **The selected boxes**, **Boxes whose words are gone** (left behind when their words were deleted from the text), or **All word boxes on this page**, which asks first and leaves features alone. The Delete key removes the selected boxes too, but only while the image or its tools have the focus: in the text, Delete removes words. Pressing **Select line**, Shift-clicking a box or dragging one gives the focus to the image.

Word boxes made by **Map lines** are an estimate, and seldom right all along a line. To correct them:

- **One box**: click it on the image, then drag it or its corners.
- **Several boxes together**: select their words in the text, or use **Select**: **The boxes of the caret's line**, **All word boxes on this page**, or **Boxes in an area** (draw around them; a box is taken when its middle lies inside). Shift-click a box on the image to add it or take it out again. Boxes whose words are gone can be selected the same way. Escape, or a click on the image beside the boxes, lets go. The selected boxes get a frame around them, and the boxes of one line carry their words above them, so you can see which box is which word. Point at a box of another line to see that line's words. Each handle has its own look and does one thing, and pointing at it lights the boxes it will change:
  - **A box**: drag it to move all the selected boxes, for example a line that sits too high. The arrow keys do the same a little at a time once the frame has the focus (Shift for ten times as far). A click without dragging selects that box alone.
  - **The bar at the end of a box**: makes that word wider or narrower. The boxes after it on the same line move along and keep their size; the boxes before it stay. This is the quick fix when one word was much wider or narrower than estimated.
  - **The round knob under the gap between two words**: moves the boundary between them. The first word's box then ends exactly where the next one's begins; one gets more room, the other less, and nothing else moves.
  - **The square handles on the frame**: stretch or squeeze all the boxes evenly. Use the sides for a line written wider or narrower than estimated, and the top and bottom for taller or lower lines.
  - **The round handle beyond the end of the frame**: turns all the boxes about the middle of the group, for a line or a block of lines that slopes. Lift or lower it like the end of the line; hold Shift to turn finely. The angle is shown beside it. Once turned, everything else follows the slope: a box's end, a boundary or a stretch runs along the line. A single box can be turned on its own too, with the handle the image shows when it is selected.

**Undo** and **Redo** in the facsimile tools, or Ctrl+Z and Ctrl+Shift+Z while the image has the focus, take back or do again what was done to the boxes of the page: made, moved, resized or deleted. Pointing at the buttons says what they will undo or redo. This history lasts while the page is open.

Undo in the text brings back the very words it removed, with their boxes, features and normalized forms.

### Settings, export and deleting

**Settings…** changes the name, whether the transcript is diplomatic and normalized, the works the transcript is for, and its **Sources** and **Licence**: what it rests on, where that matters, and the licence it may be used under. Both go into its TEI export. **Download TEI** gives the transcript as TEI XML with its pages, zones and segment labels. **Delete…** removes it, which is refused while an edition compares it. A published transcript is open to readers at its address, read only.

## The edition

An edition is a text you edit like any other text, with an apparatus that Varians derives by comparing it with the witnesses. Every word of the edition remembers where it came from: a witness, a conjecture, or your own hand.

### Making one

On a work's page, choose **New edition**. Give it a title as it will be printed and the editors' names, one in each field (**Add editor** for another), and choose:

- **Base transcript**: the transcript whose normalized text becomes the first text. Usually the witness you trust most. You can also start from an empty text.
- **Segments**: all the segments that transcript has, or a range such as 1.1 to 1.100.
- **Witnesses**: which transcripts the apparatus compares, and the siglum each goes by in this edition. A witness can have different sigla in different editions.
- Under **Witnesses and Sigla…** in the editor, a manuscript can also be compared in further **states**, each under a siglum of its own: as first written (before correction, by default A¹), after a stage of correction (A², A³), or with the corrections of one hand (A m2); and with the variants it notes in its margins or between its lines (A v.l.). The states are derived from the deletions and additions in the transcript and the hands and stages they name (see *Features* under Transcribing). Where a state agrees with its manuscript, the apparatus names the manuscript alone. Collate only the states that matter for the witness: a manuscript with trivial corrections needs A alone; one with meaningful layers A¹ and A; one with identifiable hands a siglum per hand.
- **Conventions**: verse or prose lineation, how often a label is printed, a positive or negative apparatus, Latin abbreviations (om., add., del.), and where the interpretative variants are printed: with the others, in a list of their own under the apparatus (the default), or not at all. They are always in the TEI export, marked `type="interpretative"`.

Everything chosen here can be changed later from the **⋯** menu of the editor: **Edition Settings…** and **Witnesses and Sigla…**.

### The editor

The editor has three parts. Drag the lines between them to give one more room; the editor remembers the sizes. Double-click a line to put it back as it was.

- **The text** in the middle. Type in it as in any editor; your changes are saved by themselves a moment after you stop. The status beside the title says **Saved**, **Saving…** or how many changes are waiting.
- **The apparatus band** at the foot. It shows the places where the witnesses differ from your text, segment by segment, for the part of the text around the caret. The words of such a place are dotted in the text.
- **The side pane** on the right, with two tabs. **Witnesses** shows one witness at a time, as text (normalized, or diplomatic where the transcript has it) or as the image of its page, following the caret. **History** shows the history of the edition.

### Adopting readings

Each place in the apparatus band lists the readings: your text first, then what each witness has.

- Click a reading to **adopt** it: the words in your text are replaced by the witness's words. The adoption is recorded, and **Undo adoption** takes it back.
- An omission is a reading like any other: adopting it removes the words from your text, and the apparatus then reports them as the reading of the other witnesses. To keep words in the text but mark them as spurious, register a conjecture of the kind deletion and adopt it: the words are printed in the edition's deletion brackets.
- **Keep the text** marks a place as reviewed without changing anything. The counter at the left of the band says how many places are left to review, and **Next to review** goes to the next one.
- In the witness pane, clicking a word adopts that witness's reading at that place.
- Each place says whether it is **textual** or **interpretative** (see *Diplomatic and normalized*). Click the word to call the place the other kind; it is then marked with an asterisk, and a second click goes back to what the letters say. A conjecture with other letters makes a place textual whatever the witnesses have.
- In a Greek edition, a textual reading is labelled by how it stands to your words, from the analyser of Greek forms: **form** (another form of the same word: they share a lemma), **word** (another word), or **order** (the same words in another order). Where the analyser does not know a word, or the readings have different numbers of words, there is no label.

Every word remembers the witness it was taken from. When that witness's transcript is corrected later, the word is underlined with a wavy line and the band says, for instance, "ἄειδε: taken from A, which now reads ἄειδεν", with **Take A's reading** to follow the correction. A word you typed over is yours, and is never reported this way. **Colour words by source** tints the words that come from conjectures and from your own hand.

### Conjectures

A conjecture belongs to the work, not to your edition: once registered, every edition of the work can show it and adopt it, and the work's page lists it in the conjecture catalogue.

- Select the words the conjecture concerns and choose **Conjecture…** in the small toolbar that appears under the selection, or press Alt+C.
- Choose the kind: substitution, deletion, addition or lacuna. Type the reading, the scholar who proposed it, and, under **References**, the works where it was proposed or discussed, with pages. References come from the shared bibliography.
- **Register** records the conjecture; **Register and adopt** also puts it into your text. A conjecture registered in an edition belongs to the edition's owner, like the edition's text, so that every collaborator sees it.
- The apparatus band shows the work's published conjectures, and the drafts you may see: your own, and the edition owner's when you collaborate. Another person's draft can be adopted once they publish it.
- A conjecture registered on the work's page that concerns words of your text appears in the apparatus band at its place, with its proposer, and can be adopted from there.

### Marks, objects and notes

With words selected, the small toolbar under the selection offers:

- **Supplied ⟨ ⟩**, **Deleted [ ]** and **Crux †**, printed with the brackets set in the edition's conventions.
- **Line ↑** and **Line ↓**, which move whole lines when the edition prints them in another order than a witness. The apparatus then says where each witness has the line.
- **Conjecture…** and **Note…**.

**Insert** at the top right of the text puts things that are not words at the caret: a speaker, a heading, a stage direction, a marginal note or a lacuna mark. A note is free text on a segment or on some of its words, with references if you want them; the reader prints notes under the apparatus.

### Publishing

**Publish** makes the edition public as it stands, as a numbered version. Readers see that version, and it stays citable when you go on editing: each published version keeps its own address, and its apparatus stays as it was published, compared with the witnesses as they then stood. **Preview** shows the reader on your current draft. **Unpublish** in the **⋯** menu takes the edition back to a draft.

Publishing an edition also publishes what it rests on, as far as it is yours: your transcripts it compares, and your conjectures and reported readings on the work. A transcript of someone else's that is still a draft cannot be published by you: publishing is refused until its owner publishes it, or you take it out of **Witnesses and Sigla…**.

Readers only ever see published versions. The working state of your edition, its history and its notes as they stand now are for you and your collaborators.

### Sources and licence

**Edition Settings…** has fields for the edition's **Sources** (what it rests on beyond its witnesses: an earlier edition, a commentary) and its **Licence** (such as CC BY 4.0). Readers find them under *About this edition*, followed by a link to **Sources and licences**, the page that lists the data and resources Varians itself uses (typefaces, dictionaries) with their licences. The page is linked from the foot of every page too. A copied edition keeps the original's sources and licence until you change them.

### Copying an edition

**Make a Copy…**, in the editor's **⋯** menu or in the reader's menu, makes a draft edition of your own:

- **From your own edition**, or one you edit: the edition as it stands now, with its editors' names.
- **From someone else's published edition**: the published version, with the witnesses it was published with. The editors' names are left for you to give. Witnesses whose transcript you may not see come without one; Varians says how many, and you can choose others under **Witnesses and Sigla…**.

The copy brings the text with every reading's source, the witnesses and sigla, the adopted conjectures, the notes and their references, and the settings. It does not bring the history, the collaborators, the review marks or the published versions. Its reader says where it came from: *Based on* the original, with its editors and the version copied.

## The reader

A published edition has a public page at `/editions/` followed by its address, such as `/editions/iliad-1`. It shows the published version to everyone; its editors also see the draft through **Preview** in the editor.

- The text is set with its line labels in the margin. Words where the witnesses differ have a dotted underline. Click or tap one, or reach it with Tab and press Enter, to see what happens there, in plain sentences: which witnesses the edition follows, what each of the others has ("Venetus B leaves these words out", "Venetus B reads κύνεσι, another form of the same word", "Venetus B reads the same letters otherwise: ἄειδε,"), the conjectures with their proposers and references, and the editor's notes.
- **Variants**, in the bar above the text, opens a panel that explains every place on the lines in view, in the same plain way, so that a whole page can be followed. Pointing at a place lights its words in the text; clicking it goes there.
- **Reading settings** (the gear) change the text size. They can also show the apparatus as in print, below or beside the text, in its concise form with sigla, and put the interpretative variants with the others, in a list of their own, or out of sight, whatever the edition does. The settings are remembered in your browser. Printing always gives the print apparatus.
- On a wide screen the panels stand beside the text; drag their left edge to make them wider or narrower.
- **Witnesses** opens the conspectus siglorum and the text of any witness beside the edition, with the words of the open entry lit. Where the witness's transcript is diplomatic as well as normalized, a switch shows its **Diplomatic** text: how the witness writes the words the apparatus counts. **Facsimile** shows the page of the manuscript where those words stand, when the words are mapped to an image.
- **Dictionary** (in Greek editions) looks up any word you click while it is open, or one you type: its possible lemmas and grammar, from the treebanks and the Morpheus analyses, and the entries of the lemma in Liddell, Scott and Jones and in the Middle Liddell, each marked with its dictionary and licence. A word with variants opens its variants as well.
- **Search** finds words regardless of accents and steps through the matches.
- The menu offers the edition as plain text with its apparatus and as TEI XML, and lists the published versions. Each version keeps its address, `/editions/iliad-1/v/2`, and reads exactly as it was published: its apparatus does not change when a witness is corrected later. A passage has its own address too, such as `/editions/iliad-1/1.5`.
- Printing gives the text with its print apparatus, without the controls.

## History

Every change to a transcript or an edition is kept, with who made it and when. Nothing needs to be switched on. Open the **History** tab beside the text.

### Moments

The **Moments** list shows the history newest first, gathered into sessions: one person's work without a long pause, such as "Iris Second, Today, 14:02 to 14:40, 3 words added, 1 changed". Named moments carry a bookmark, and published versions say **Published**.

- Click a moment to see the text as it stood then, with the changes since the moment before marked: added words underlined, removed words struck through where they stood, re-spelt words underlined faintly with the old spelling shown when you point at them, and moved words with a small arrow. Each person's changes have their own colour. **Changes since** compares with any earlier moment instead.
- **Name this moment** gives the moment a name, such as "before the collation", so that you find it again.
- **Bring the text back as it was** restores the whole text to that moment, as a new change of yours. Nothing is lost: the history keeps everything, and bringing back can itself be undone.
- **Show the changes** under a session lists its single changes; **Undo this change** takes one back. When later changes touched the same words, Varians names them and asks before it undoes what it can.

### Review

The **Review** tab lists what others changed since you last reviewed, each change with its author, its time, and the lines it touched before and after.

- **Accept** marks a change as seen and good.
- **Reject** undoes it.
- **Later** leaves it for another time.
- **Review from** starts the review at a named moment or a version, for instance from the last published version.

## Working together

The owner of an edition invites collaborators from the **⋯** menu with **Collaborators…**, by the email address of their account. Collaborators edit the edition, the transcripts it compares that belong to the owner, and the owner's conjectures on the work. Only the owner publishes, invites and deletes.

**Offer Ownership…** hands an edition to someone else. Ownership moves when that person accepts the offer on their account page; the former owner stays on as a collaborator.

Two people may edit the same text at the same time. When both change the same words, the change saved first stands, and the other person is told that theirs was set aside.

## The bibliography

The bibliography is shared by everyone on the installation and kept in biblatex, the format of most reference managers. Open it from the header.

- **Import .bib** reads a file exported from Zotero, JabRef or any other reference manager. Entries with new keys are added. Your own entries with a key that already exists are updated; entries someone else added are left as they are.
- **Add entry** takes one biblatex entry. The label the apparatus cites by, such as "West 1998", is made from the names and the year.
- **Download .bib** gives you the whole bibliography back.
- An entry that something cites cannot be deleted until the citations are removed.

Conjectures, reported readings and notes cite entries under **References**: search by author, title or year, choose the entry, and add what comes before it ("cf.") and the pages after it. An edition's works cited are the entries that its apparatus and notes cite.

## The archive

Varians keeps a copy of every work outside its database, in open formats, so that the work outlives the program. For each work the server keeps a git repository with:

- the work, its reference scheme, its segments and its witnesses as JSON, with the segments also as a table, each with its CTS URN where the work has one;
- every transcript as TEI XML, with the facsimile zones;
- every edition as TEI XML with a critical apparatus, and as plain text and Markdown for reading without any tools;
- the token streams, adoptions, notes, the editors' alignment constraints, the sites looked at, and the full history of changes as JSON, for what TEI cannot carry exactly;
- the bibliography as `.bib`, and the images as their original files;
- a README saying where the format is specified.

Every record of the work is in the archive, so that the work can be rebuilt from it alone. A change is in the archive's files within a minute of the last save. A commit marks every named moment and every publication, in the name of the person who made it, and the rest is committed every night. Anyone signed in who can see the work downloads it from the work's page as a zip, a few times an hour, holding what that person may see: an edition they do not edit comes as its published version, and no one's review positions are included. An administrator gets the server's repository itself, with its history.

The files follow the **Varians Data Format**, whose specification, JSON Schemas and TEI customization every installation serves at [/formats](/formats). `pnpm --filter @varians/web cli import-archive <folder> --user <email>` reads an archive back into an installation, which is also how a work moves from one installation to another.

## Keyboard

In the edition editor:

| Keys | Action |
|---|---|
| Alt+↓, Alt+↑ | next or previous place in the apparatus |
| Alt+N | next place still to review |
| Alt+1 to Alt+9 | adopt the first to ninth reading at the caret's place |
| Alt+K | keep the text: mark the place as reviewed |
| Alt+C | register a conjecture on the selected words |
| Alt+I | insert a speaker, heading, note or lacuna at the caret |
| Alt+Shift+↑, Alt+Shift+↓ | move the selected lines up or down |
| Ctrl+Z, Ctrl+Shift+Z | undo and redo (Cmd on a Mac) |

Everywhere a pane can be resized, the line between the panes takes the keyboard too: reach it with Tab, move it with the arrow keys (with Shift in larger steps), and press Enter to put it back as it was.

In the workbench:

| Keys | Action |
|---|---|
| Ctrl+Shift+U | unclear |
| Ctrl+Shift+S | supplied |
| Ctrl+Shift+D | deleted |
| Ctrl+Shift+A | added |
| Ctrl+Shift+B | abbreviation |
| Ctrl+Shift+G | gap |
| Ctrl+Shift+L | segment label at the caret |
| Ctrl+Shift+P | page break before the caret's line |
| Enter | new line |
