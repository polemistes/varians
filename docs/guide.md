# Using Varians

This guide is for editors: the people who transcribe witnesses, collate them and make editions in Varians. It follows the work in the order it is usually done. It says how to use them.

## The parts of Varians

- A **work** is a text as an abstract object: the Iliad, Plato's Symposium. It exists once in Varians and is shared by everyone. It has a **reference scheme**, the way its passages are numbered (book and line, Stephanus page and section), and its numbered passages are its **segments**, such as 1.5. A segment is an address in that numbering: what a reader cites, and what the words of a transcript are assigned to. It is not a line. A verse edition often shows a segment as a line, a prose edition never does, and a word may run from one segment into the next.
- A **witness** is a physical carrier of the text: a manuscript, a papyrus, an inscription, a printed edition. It too exists once, with its **pages** and their images.
- A **transcript** is one person's transcription of a witness. It belongs to that person.
- An **edition** is a critical text of a work, made by comparing transcripts. It belongs to its editor.
- A **conjecture** is a proposed reading. It belongs to the work, so that every edition of the work can use it.

Works, witnesses and the bibliography form a shared **registry**: before you add something, Varians shows what already exists, so that the Venetus A is entered once and used by everyone. Whoever adds an entry **maintains** it and decides who else does; maintainers edit its details, and any of them may step down. Using an entry needs no permission.

## Finding your way

The **front page** shows visitors what Varians is and lists the published editions. Signed in, it offers the ways in: **Make New Edition**, **Add New Work**, **Add New Witness** and **Make New Transcript**; under **Continue** are your most recent editions and transcripts, so that one click takes you back into them; and under **Editions** the published editions, as for visitors.

The header leads everywhere else: **Your Work** (all your editions and transcripts, and what others share with you), **Editions** (everything published, to read), **Works** and **Witnesses** (the registry), and **Bibliography**. **Search:** in the header is the one search: it finds published editions, works, witnesses and bibliography entries at once. This guide is at **Guide** in the footer of every page.

**Make New Edition** opens the one page on which an edition is made (see _Making one_ under The edition). **Make New Transcript** asks which witness, then opens its form for a new transcript.

## Your account

**Register** in the header makes an account. Where the installation sends mail, a link to confirm the address is sent first, valid for a day, and the account can be used once the address is confirmed; logging in before then sends a new link. **Forgotten Your Password?** on the login page sends a link to set a new one, valid for an hour; where the installation sends no mail, its administrator gives you such a link. Setting a new password ends every other session of the account.

The footer of every page names the version of Varians that runs the site and links its source code.

**Tokens** on the account page let another installation of Varians, or a script, read and send packages of the works you may see, as you; a token is shown once, and can be revoked at any time.

Your name and your **ORCID iD** on the account page go with your work: the history of every text names you, and the TEI, the citation of an edition and the archive give your ORCID iD where you have given one. If work was brought in from another installation under your ORCID iD before you had an account here, giving the same iD here makes that work yours.

## A work

Choose **Add New Work** on the **Works** page or on the front page. As you type the title, works with a similar title or author are shown; if yours is among them, open it instead of making a second one.

- **Language** sets how words are normalized and compared when witnesses are collated (see _Diplomatic and normalized_ under Transcribing). For Latin, u and v count as one letter; for Hebrew and Arabic, the vowel points are left aside.
- **Identifier** is optional: the work's CTS URN, such as urn:cts:greekLit:tlg0012.tlg001. Passages of the work are cited by it in the TEI.
- **Identifiers** lists further canonical identifiers, each a scheme and a value: a CTS URN, Diktyon, Trismegistos, Wikidata (Q8275), VIAF, a URL, or Other. Each value is checked against the form of its scheme. They are shown on the work's page, linked where the scheme has a resolver, and the search finds the work by any of them, so that pasting Q8275 finds the Iliad. An archive brought in from another installation is matched to the work here by its identifiers before a new work is made.
- A work is always public and can be listed by all users. Look for the work before adding it, so as not to make a duplicate of one already registered.
- **Reference scheme**: choose a common one (book and line, chapter and verse, Stephanus page and section) or describe your own levels. An example label shows how passages will be written.

The work's page lists its editions, the witnesses transcribed for it with how much of the work each covers, its conjectures and reported readings, its segments, and its archive. Maintainers change the details, the scheme and the maintainers under **Edit**.

### Merging two works

When a work has been registered twice, the duplicate is merged into the other under **Edit**, **Merge into…**: find the surviving work by title, author or identifier, and Varians shows what will move and what prevents the merge. Segments are matched by their address: the duplicate's 1.5 and the survivor's 1.5 become one segment, and everything that named the duplicate's (the text of its transcripts and editions, conjectures, reported readings, notes, citations) names the survivor's; segments the survivor lacks move to it, labelled in its scheme. The editions, conjectures, reported readings, transcripts and maintainers of the duplicate go to the survivor with them. Two works whose reference schemes have different levels cannot be merged, since their segments cannot be matched. The survivor keeps its title, description, visibility and scheme, and gains the duplicate's identifiers; its page lists the works merged into it. The duplicate's address and identifiers lead to the survivor from then on, also in archives brought in later. Moving a segment within a transcript or an edition is not a change of its text and is not recorded in its history. Administrators and those who maintain both works may merge them, and a merge cannot be undone.

### Conjectures and reported readings

The work's page keeps the catalogue of conjectures. **Add conjecture** asks for the segment (such as 1.5), the kind (substitution, deletion, addition, lacuna, supplement, transposition), the words it concerns, the reading, the scholar who proposed it, the works where it was proposed, and a note. A conjecture starts as a draft that only you and the editors you work with see. Tick **Published** to make it part of the shared catalogue; publishing an edition does this for your conjectures on its work.

A **reported reading** is what a witness is said to have at a variant, by another edition's apparatus or a collation, without a transcript of that witness. It stands among the readings of the variant under the witness's siglum, with its source.

## A witness

Choose **Add New Witness** on the **Witnesses** page, or **Make New Transcript…** on a work's page and then **Add New Witness**. Every field but the name and the siglum is optional: repository, place, shelfmark, identifier (a catalogue number), identifiers, date, material (from a list, or **Other** with a word of your own), extent, hands, provenance and a description. **Hands** is a list: each hand has a label as the catalogues cite it (m1, m2, A²) and a description, and one of them is marked as the scribe of the text. Corrections in the transcripts of the witness can then name the hand that made them (see _Features_ under Transcribing). The siglum given here is a default; each edition gives the witness its own.

**Identifiers** are canonical identifiers of the witness, each a scheme and a value, as for a work: a Diktyon number for a Greek manuscript, a Trismegistos number for a papyrus, a Wikidata item, a URL. The witness's page links them to Pinakes, Trismegistos and Wikidata, and the search finds the witness by any of them: pasting a Diktyon number finds the manuscript.

The **category** says what the carrier is: a manuscript, an inscription, a printed edition, an indirect source (a text quoting or reporting this one), or something else. A papyrus is a manuscript: give papyrus as its material. For a manuscript, the **format** says whether it is a codex, a roll or a single sheet, or that this is not known; a roll's pages are best labelled as columns, col. i, col. ii. For an indirect source, give the author and the work that quote the text, such as Athenaeus, Deipnosophistae; the passage goes with each reading reported from it. A witness that survives in pieces has its fragments as pages, labelled as you cite them (fr. 1, fr. 2 verso).

Whether a witness has all of a text or only part of it is a matter of the work, since one codex may hold all of one text and part of another. The work's page shows it for each witness, as complete or partial, from the passages its transcript covers.

The witness's page shows its pages, its transcripts and the works they belong to. **Make New Transcript…** asks for a name, the work it is for, whether to keep a diplomatic form beside the normalized one, and optionally another transcript to start from.

**Delete Witness…**, in the **⋯** menu beside **Edit** on the witness's page, deletes the witness with its pages, their images and your own transcripts of it. Only the person who registered the witness and administrators may delete it, and it is refused while an edition's conspectus names the witness or while someone else's transcript or reported reading depends on it: the menu item is then greyed, and says what stands in the way.

### Merging two witnesses

A witness registered twice is merged into the other with **Merge into…** in the **⋯** menu on the witness's page (or under **Edit**), as works are. Its transcripts, reported readings, sigla in the conspectus of editions, maintainers and pages go to the surviving witness, the pages after the survivor's own, with the hands and identifiers the survivor lacks. Two things prevent the merge until they are resolved: an edition whose conspectus names both witnesses (remove one of them from it), and a page label both witnesses have (rename, move or delete one of the pages). The survivor keeps its description and siglum; its page lists the witnesses merged into it, and the merged witness's address leads to it. Administrators and those who maintain both witnesses may merge them, and a merge cannot be undone.

### Pages and images

The pages of a witness are managed in two places, with the same means: on the **Pages** tab of the side pane while transcribing (see below), and under **Manage Pages** on the witness's page. Both are for the maintainers of the witness; everyone else sees the pages.

- **Add Images** takes several image files at once, one page per file, in the order of the file names. The labels come from the file names, or continue the sequence of the last page (12r, 12v, 13r). Large files show their progress; the image is tiled for fast zooming. Every image needs a **rights statement** (see _Licences and rights_); the upload is refused without one. The statement, the **credit line** and the **source** (the address the images were obtained from, if you want to record it) chosen here are given to every file of the upload.
- **Add Pages** makes pages without images from a range such as 1r-12v, 1-20, p. 1-20 or col. i-iv, or from a list. Images can be added to them later.
- **Import IIIF Manifest…** takes the pages of a manuscript published by a library, with their images, which stay on the library's server. A preview shows what will be imported, with the manifest's rights statement and credit line. Import only the pages not yet there, or replace the pages nothing refers to. The manifest's address is kept on the witness and shown on its page, and on each page as the source of its image. Each page keeps the rights statement and credit line of its canvas, or of the manifest where the canvas gives none; where the manifest states no rights at all, the pages take the witness's defaults. A statement that is not among those Varians lists is not kept: the preview says so, and its address becomes the pages' credit line where the manifest gives none.

The witness's **Edit** page has a section **Images**: the **Rights of images** and the **Credit line** that new images of the witness are given, so that an upload starts with them and an image dropped on a page goes up with them at once. Saving them can also give them to the images of the witness that have no rights statement yet, such as those imported from a manifest that stated none.

Every page is a card with its image, its label, its number and the rights statement of its image, or _No rights statement_ where it has none. A page without an image says so, and **Add an Image…** on the card takes one, with its rights statement, credit line and source. An image file dropped on any card becomes that page's image, in place of the one it had: with the witness's rights statement when the witness has one, and otherwise after asking for it. The card's menu (**⋯**) renames the page, moves it up, down or to a position, adds, replaces or removes its image, changes the **Rights of the Image…**, and removes the page. The rights belong to the image: they move with it to another page, and go when it is removed. The menus, buttons and headings of Varians use capitals as English titles do (**Move Up**, **Remove Page…**); the labels of fields do not. Click the label to rename it in place.

**Move Image to Another Page…** in the menu is for an image that was given to the wrong page: choose the page it belongs to, and the image goes there; when that page has an image of its own, the two change places. The next page is proposed, which is where an image most often belongs when the pages were counted wrong. Mapped words (zones) stay with their page, as they do when an image is replaced, and show on whatever image the page then has.

**Shift Images from Here…** mends a whole run of images that is one page out, as happens when a page was missed or counted twice while scanning. Open it on the first page that is wrong and choose a direction:

- **One page later**, for images that began one page too early: this page and every page after it take the image of the page before them. When the last page has an image, a new page is added at the end for it, labelled after the last one (2v is followed by 3r).
- **One page earlier**, for images that began one page too late: the page before this one takes this page's image, and so on to the end. The page before must have no image of its own.

Pages without an image within the run keep their place in it, so a gap moves along with the images. Zones stay with their pages here too.

A page's text belongs to the transcripts, not to the page. Removing a page never deletes text: the text on it goes to **Not on a page** in every transcript of the witness, other people's too, as a change in each transcript's history made by you and saying which page was removed. The dialog says how many words in how many transcripts that is. The image and the boxes drawn on the page go with it. Moving a page to another position moves its text with it in every transcript, since a transcript's text follows the order of the pages.

## Transcribing

A transcript is a stretch of a witness as you transcribe it: usually one work's text, sometimes a whole manuscript running through several works. You may make as many transcripts of a witness as you like, also of the same work: two readings of a damaged papyrus, or a copy to try something on. An edition always says which transcript stands behind each siglum.

A transcript is **for** one or more works, chosen when you make it and changed under **Settings…**. The first of them gives the defaults: which work's segment labels are offered, and which spelling rules propose normalized forms for text not yet assigned to a work. Text you assign to a work's segments belongs to that work whether it is chosen here or not, and each stretch is read by its own work's spelling rules, so a Greek text and a Latin one in the same manuscript are each treated right. A transcript is listed on the page of every work it is for or has text of.

A transcript opens in the workbench: the text one page at a time, and beside it the facsimile of that page, the other form of the text, its history, or the pages of the witness. The side pane stands on the right; **Facsimile on the Left** in the **⋯** menu puts it on the left, and your browser remembers the choice and the pane's width.

Above the text is the bar you work with: the page shown, with arrows to the page before and after, **Diplomatic** and **Normalized** where the transcript keeps both forms, **Insert** and **Tools**. The header above holds what concerns the whole transcript: the button that shows or hides the side pane, and the **⋯** menu (**Import…**, **Number Lines from Here…**, **Settings…**, **Download TEI**, **Open the Witness**, **Make a Copy…**, **Delete…**).

A transcript opens on the page you last had open in this browser. The first time, it opens on the first page that has text; when no page has text yet, on the text that is not on a page; and when there is no text at all, on the first page, empty, with its facsimile beside it, ready to be typed. A transcript of a witness without pages, such as a printed edition, opens on its text; one whose witness has neither pages nor text opens with the **Pages** tab showing, since a manuscript's transcription begins with its pages.

The status line at the foot says whether your work is saved, which page is shown and how many lines it has, how many words are not on a page, how many words are not yet mapped to the image, and how many words have a normalized form still to check.

### Bringing a text in

**Import…** in the **⋯** menu brings in two different things, and treats them differently.

**A text to start from.** Often there is already a text of the work: an earlier edition, a text from the web. It is not a witness and not a source: it saves typing, and once it has been corrected against the witness, the witness is the only source there is. So only its words and their numbering are taken, with its lines and paragraphs. Its editor's brackets and notes, its speakers and headings, and its pages, which are the pages of that edition, are left behind, and nothing is recorded of where it came from. It comes as:

- **TEI**: a file, a web address, or a CTS URN such as `urn:cts:greekLit:tlg0012.tlg001.perseus-grc2:1.1-1.10`. Varians reads the structure it finds (books, lines, chapters) and proposes how its numbering maps onto the work's segments; you can correct the mapping before importing.
- **Plain Text**, with the numbering it finds at the starts of lines or in brackets.

**A transcript of this witness**, made by someone who read the witness itself. Here the source matters and can be recorded with the transcript's sources, and the transcript is read with everything it says of the witness. It comes as:

- **TEI or EpiDoc**, with its features and its pages.
- **Leiden** conventions, as epigraphers and papyrologists print them, and **Leiden+**, the notation of papyri.info, with everything it can say of a papyrus: lost and illegible letters and lines, unclear letters, the scribe's deletions, additions and corrections, abbreviations and symbols, numbers, glyphs, hands, vacats and paragraphoi.
- **PAGE or ALTO**, the formats of text recognition programs, with the position of every word on the image.

A TEI file may be either, so the import asks which it is before it reads the file.

An import into an empty transcript becomes its text; otherwise it is added to what is there, or replaces the whole text if you ask. Either way it is one change in the history. **Place** says where text goes that the file does not put on pages: **Not on a page**, or the page shown. A transcript in TEI whose page breaks (`<pb n="12r"/>`) carry the labels of the witness's pages puts each page's text on that page, after any text the page has; text under a page break that names no page of the witness goes to Not on a page, and the summary says how many words went there. If you maintain the witness, the pages the file names and the witness lacks are added to it, as they are for PAGE and ALTO. For a transcript, give where it was made under **Source of the transcript**, and it is added to the transcript's sources.

A transcript holds what its witness has, and nothing an editor added to it. So a transcript that is imported leaves out what its editor supplied: where letters are lost and were restored in square brackets, the gap is kept and the restoration is not, and the witness is not there at the gap (see _Gaps_). A word that the gap breaks keeps the letters that are there and counts with the gap. The editor's regularizations and corrections of the scribe's spelling become the normalized forms of the words; corrections, and letters the editor added in angle brackets or struck out in braces inside a word, are marked as unchecked for you to confirm. A whole word the editor added is left out, and a whole word the editor struck out stays, since the witness has it.

Another transcript can also be the starting point: choose it under **Start from another transcript** when you make a new one, and correct the copy against your witness.

**Make a Copy…** in the **⋯** menu copies the transcript you are looking at, yours or a published one of someone else's: a draft of your own with the text, the works, the settings, the remembered normalized forms and the boxes on the images. Its history starts afresh and says where it came from.

### Typing

Type as in any editor. Enter starts a new line. The arrows beside the page label, or Alt+Page Down and Alt+Page Up, move between the pages; the list under the label goes to any of them.

**Insert** puts a column break or a paragraph break before the caret's line, wherever in the line the caret stands, and at the caret a **Gap**, **Not Transcribed**, a **Space** (left blank by the scribe), a **Figure** or a **Note**. While the menu is open, a dashed rule shows where a break would go. A roll's columns can also be registered as its pages. The two gaps are described under [Gaps](#gaps).

A word divided at the end of a line is joined across the line break: type a hyphen and Enter where the scribe divided it, and Varians keeps the two parts as one word, compared whole. The hyphen is not kept as a character: Varians draws one where a line ends inside the word, and nowhere else.

**Pages** in the page list, or the **Pages** tab of the side pane, shows every page of the witness as a card with its image and, for this transcript, how many lines of text it has; the page shown is marked, and a click on a card goes to that page. If you maintain the witness, this is also where its pages are managed while you transcribe: add images and pages, import a manifest, and use each card's menu, as described under [Pages and images](#pages-and-images). When the page shown has no image yet, the **Facsimile** pane offers **Add an Image…**, and an image file can be dropped there.

### Pages

Each page of the witness has its own text in a transcript, and you type a page's text on that page: there is no page break to make, and nothing marks where a page begins. A page that has no text yet is simply empty. The page list marks the pages that have text.

Text that stands on no page has a place of its own, **Not on a page**, first in the page list. It is where imported text arrives when the file does not say its pages, where the text of a removed page goes, and where you can type what you cannot yet place. It is the transcript's text like any other: it is segmented, collated, exported and published. The text of a transcript reads in the order of the pages, Not on a page first; reordering the pages reorders the text, so misbound leaves are listed in the order the text reads.

Text is put on its page by moving it. Select it, and the toolbar under the selection offers **Move to 12r**, proposing a page, with a list beside it of the other pages and Not on a page. The words go to the end of that page's text, on a line of their own, with their features, their segment and their place in the history; Ctrl+Z takes the move back. The page shown stays, and the status line says where the words went, with **Show** to go there. Words that leave a page leave their boxes on its image behind.

In Not on a page, the **Facsimile** pane shows a page chosen above the image, by default the first page without text, and **Move to…** proposes that page. So the work goes: look at the image, select the passage that stands on it, move it, and the facsimile goes on to the next page without text. Choose another page above the image when the text runs otherwise.

Cut and paste also move words: cut a passage, put the caret where it belongs (on another page too), and paste, and the words are the same words, with their features and their segments; their boxes stay behind when they leave their page. Copy and paste makes new words, as in any editor, and is not how text is placed: a copy left behind would be collated as well, and the witness would read the passage twice.

**Whole text**, at the end of the page list, shows the whole transcript at once, read only, each page's text under its label and the text not on a page under its own heading. Double-click a word to open its page with the word selected.

### Diplomatic and normalized

Every word of a transcript has a **normalized** form: the word as it is read, in the spelling the edition uses. A transcript can also keep a **diplomatic** form of every word: letter for letter as the witness writes it, with its capitals, its spelling and its accents or their absence. Choose **Keep a diplomatic form beside the normalized** when you make the transcript, or later under **Settings…**; without it the transcript is normalized only. The **Diplomatic** and **Normalized** switch at the top shows one text or the other for editing; the side pane can show the other beside it.

- Varians proposes normalized forms from the language of the work each stretch belongs to: capitals lowered, final sigma, abbreviations expanded where you marked their expansion. **Normalized Forms Proposed** in the status line lists the proposals; accept them all or some. It never adds accents or breathings.
- Every normalized form you type or accept is remembered for this transcript, and proposed again for the same diplomatic form.
- A word whose diplomatic form changes after its normalized form was set is marked faintly until you **Confirm** it. Where the two agree apart from letter case and accents, it is confirmed by itself.
- Features can be marked on single letters of the diplomatic form (an unclear letter, a supplied one); the normalized form is always the whole word.

**What a variant is made of.** A variant is a difference of words, never of ways of writing them. Collation compares the normalized texts only, as you type them, without regard to letter case; the diplomatic texts play no part. Whatever differs between a witness's diplomatic and normalized forms is therefore normalization: the scribe's spelling, iotacism, abbreviation, accents written otherwise than the word you read requires. Where two witnesses' normalized forms differ, also only in an accent, a breathing or a punctuation mark (ἦ, ἤ), that is a variant. So give a word a different accentuation, or a passage a different punctuation, from the other witnesses only where its manuscript gives reason to. A grave counts as an acute, since it only marks the word's place before another, and the marks of elision count as one. How a witness writes its words is its diplomatic text, which readers can see beside the edition (see _The reader_).

**Where a variant begins and ends.** Each witness is compared with the edition's text by itself, so the order of the sigla changes nothing. A variant is as wide as the departure that makes it: a word read otherwise is a variant, and so is a stretch that a witness does not have or has in another order, and so are words that a witness has between two of the edition's. Variants that stand next to each other are separate, unless the same witnesses differ at both, when the phrase is one variant. A word spelt otherwise within a stretch that another witness does not have is a variant of its own, in which that witness is not named. Where a witness has a phrase in another order, or another phrase for it, the variant is the phrase, and every witness that differs within it is given there with its words for the whole phrase. A word that a witness has in one place and is without in another nearby (within two dozen words, also across the boundary of two segments) is two variants, one where the edition has it and one where the witness does, each leading to the other.

**Passages.** A variant belongs to its words and not to a segment, and the boundary between two segments is no wall. Varians collates the text in passages: one segment, or several consecutive segments taken together wherever something may cross the boundary between them: a word divided across it, words that a witness has at it and the edition does not, a segment that a witness is without, or a witness that departs from the edition close to it on both sides. So a variant may lie across a boundary. It is labelled by the segments its words stand in (_1.5_, _1.5–1.6_), and its link in a list goes to the first of them. Words that a witness merely assigns to the neighbouring segment (its transcript begins 1.6 a word before the edition does) make no variant: they are found where they are. A word divided across two segments is one word, compared whole. Assigning the same words to segments otherwise changes the labels of the variants and nothing else, with one exception. Where your text has the same word on either side of a boundary (the last word of 1.5 and the first of 1.6 are both καί) and a witness has it once, the letters cannot say which of the two the witness has, and the witness's own transcript says it: a witness that has καί in 1.6 only is without the one of 1.5. The same holds where the witness has the word twice and your text once. Where the two stand in one segment nothing can tell them apart, and one of them is taken. A passage is at most twelve segments or 240 words; a longer run is cut where the limit falls.

**Who is there.** A variant speaks only of the witnesses whose text runs through its stretch. A witness whose transcript has a gap there (text lost, illegible or not transcribed) is in none of its readings: the gap reaches, on either side, over the edition's words that the witness has nothing for, and a gap alone makes no variant. A witness that has lost any word of a variant's stretch is not there for that variant; at a point between two words, it is not there when it has lost the word on either side or has a gap at the point. The variant over words that some witnesses are without altogether is the exception: a witness that has any of the words is there, and stands with the edition. A witness whose text runs on without the words is there, and the words are _not in_ it. Varians calls that neither an omission nor a loss, and never infers a loss from how much is missing, be it a word or a hundred segments: where the carrier is damaged or the text breaks off, mark a gap. Whether an absence is the scribe's own or his exemplar's is for a note.

A witness whose text runs on without a whole segment, which it has not lost, is without a stretch of words like any other: it is there in the variant over that segment, with _not in_, and in no variant within it. The segments on either side are one passage with it, so that words it has under the neighbouring segment are found where they are. A witness that has lost every word of a segment, or whose transcript does not reach it (it begins after it or ends before it), has no text for it: it is in no variant of the segment, the reader's list of witnesses names the segments it has _no text for_, and the editor's band says _No text here_ with its siglum.

**Textual and interpretative variants.** A variant is _textual_ where the witnesses have different letters: other words, or the same words in another order. It is _interpretative_ where they have the same letters read otherwise: in accents, breathings, punctuation or word division (ὅτι, ὅ τι). An archetype in capitals, without accents or spaces, could not tell those apart, so they record the history of the text's interpretation rather than of the text. Varians sorts each variant by its letters: an iota subscript or a diaeresis counts as a letter, and a lacuna in the edition tells nothing of letters, so a variant where only that differs is textual. The edition's editors can call any variant the other kind, mark any variant minor (see _Adopting readings_), and decide how the edition prints the interpretative ones.

**Switching.** The diplomatic form can be turned on and off under **Settings…**, each time as one change in the history:

- Turning it on, every word's text as it stands becomes its normalized form, and its diplomatic form starts as a copy. Correct the diplomatic text to what the witness has; the normalized forms stay as they were. Nothing is lost.
- Turning it off keeps the normalized text only. The diplomatic forms leave the current text but stay in its history; features marked on single letters then cover the whole word. Turning it on again copies the normalized text once more: to get old diplomatic forms back, go back in the history.

**Tools** in the workbench bar helps with the two texts, and does nothing until you ask. Each tool acts on the selected words, or on every word of the page when nothing is selected, and each is one change that Ctrl+Z undoes:

- **Normalize Diacritics** gives the normalized forms their accents, breathings and diaereses from the analyser of Greek forms (see _Sources and Licences_). Where the letters can be only one word form, it is set, accented for its place (a grave before another word, unless punctuation follows). Where the witness writes accents or breathings, only the forms that agree with them are considered, and a form you chose before for the same diplomatic word comes first. The remaining words are marked: with the caret on one, a list shows the forms it can be, each with its lemma and grammar; click one (or press Alt and its number), or **Leave as It Is**. The status line counts the words left to choose and steps from one to the next. Words the analyser does not know are marked in red: type them.
- **Take Normalized Forms from Another Text…** aligns the words with another transcript or an edition of the same work, as collation does, and where a word has the same letters as the word it stands against, gives it that text's normalized form, accented for its place here. Words with other letters are textual variants and are left as they are.
- **Remove from the Diplomatic Text**: accents, breathings, diaereses or iota subscripts, each by itself, or all four. Useful for a diplomatic text started as a copy of a normalized one.
- **All Lower Case** and **All Upper Case** change the case of the text shown. Case means nothing in the manuscripts; this is only how you prefer to present the text.

Text without word division, as in many manuscripts and inscriptions, is typed with spaces between words. **Diplomatic, without word division** in the side pane shows it as the witness has it.

### Features

Select some words or letters and the small toolbar under the selection offers the features of the text, named as TEI names them: unclear, supplied, deleted, added, abbreviation, and others. Each also has a shortcut (see below). Features are kept exactly, and come out in the TEI export.

A deletion or an addition is a correction, and **Correction…** in the same toolbar says who made it and when: the **hand**, chosen from the hands registered on the witness, or the scribe, or another hand, or not known; and the **stage**, a number for the layer of correction (1 for the first, 2 for the next), when the stages can be told apart. Both may stay unknown. What is recorded here is what an edition can collate: the witness as first written, after all corrections, after a given stage, or with the corrections of one hand (see _Making one_ under The edition). A correction that changes only the spelling shows in the diplomatic text and in the TEI but makes no variant, since variants are found in the normalized forms.

A reading the manuscript itself offers as an alternative, written in the margin or between the lines (often introduced by γρ.), is entered on the words it concerns: select them and choose **Variant…**, type the variant's words (nothing, if the manuscript's alternative is to have none), and say where it stands and, if you know it, in which hand. The words are underlined faintly with a small "v.l." after them. **Edit Variant…** and **Remove Variant** change or take it off again. Such variants stay part of the same witness; an edition can compare them as a text of their own (see below).

### Gaps

A **gap** says that the transcript has no text where the witness has some. **Insert** offers two, at the caret:

- **Gap** is for text that is lost or illegible in the carrier: a torn corner, a hole, a stain. It shows in brackets, [...]. Ctrl+Shift+G puts one at the caret.
- **Not Transcribed** is for a stretch of the witness that you leave out of the transcript. It is not a loss in the carrier and does not wear its brackets: it shows in italics as _not transcribed_ in the workbench and as (not transcribed) in the reader and the witness panes, and prints so in the plain text. In TEI it is `<gap reason="ellipsis">`, and it keeps its reason through TEI, Leiden+ and the archive.

Both mean that the witness is not there at that stretch when the transcript is collated: no variant says anything of the witness over the words the gap covers, and a gap alone makes no variant (see _Who is there_ under Diplomatic and normalized). So mark a gap where the text breaks off or is lost, and let the text run on without one where the scribe simply has no such words.

### Segments

The gutter at the left shows where segments begin: the work's labels, such as 1.5. Click a line's gutter, press Ctrl+Shift+L, or choose **Segment…** in the toolbar under a selection, to set the label of the segment that begins there; the next label is proposed. A segment can begin in the middle of a line, and a text can leave the work for a while: **Unassigned from Here**. **Number Lines from Here…** labels every following line of the page at once, as verse needs.

Segments are independent of pages. A segment runs on wherever its text runs: from one page to the next, or from Not on a page into a page. Moving text never changes the segment its words belong to, so a text can be segmented while it is all on no page and placed page by page afterwards: a line that ends one page and goes on overleaf is one segment in two parts, which come into their order as the pages fill. Where a page's first line continues the segment of the page before, the gutter shows that segment's label in grey; click it to give the line a segment of its own.

A segment is an address and not a unit of the text. It may begin or end inside a line, and a word divided at the end of a line may be divided where one segment ends and the next begins: the word is one word, its first part in the one segment and its second in the other, and it is compared whole.

### Mapping words to the image

Words are mapped on their own page: in Not on a page and in the whole text the mapping tools are greyed. The line between the text and the side pane can be dragged, to give the image or the text more room. In the **Facsimile** pane, the words you select or point at in the text light up on the image (the caret alone lights nothing), and pointing at a mapped region shows its box and lights its words in the text. Other boxes are not drawn, so the page stays readable; **Show all boxes** draws them all, and your browser remembers the choice.

- **Map Lines**: select several whole lines in the text, then draw one box around them on the image. Varians finds the lines in the box and divides each into word boxes by the length of the words; correct them as described below.
- **Map Selection**: select words, then draw a rectangle or polygon around them.
- **Feature**: with no words selected, a shape marks something on the page that is not text: a figure, damage, a marginal mark.
- **Delete** removes boxes: **The Selected Boxes**, **Boxes Whose Words Are Gone** (left behind when their words were deleted from the text), or **All Word Boxes on This Page**, which asks first and leaves features alone. The Delete key removes the selected boxes too, but only while the image or its tools have the focus: in the text, Delete removes words. Pressing **Select line**, Shift-clicking a box or dragging one gives the focus to the image.

Word boxes made by **Map Lines** are an estimate, and seldom right all along a line. To correct them:

- **One box**: click it on the image, then drag it or its corners.
- **Several boxes together**: select their words in the text, or use **Select**: **The Boxes of the Caret's Line**, **All Word Boxes on This Page**, or **Boxes in an Area** (draw around them; a box is taken when its middle lies inside). Shift-click a box on the image to add it or take it out again. Boxes whose words are gone can be selected the same way. Escape, or a click on the image beside the boxes, lets go. The selected boxes get a frame around them, and the boxes of one line carry their words above them, so you can see which box is which word. Point at a box of another line to see that line's words. Each handle has its own look and does one thing, and pointing at it lights the boxes it will change:
  - **A box**: drag it to move all the selected boxes, for example a line that sits too high. The arrow keys do the same a little at a time once the frame has the focus (Shift for ten times as far). A click without dragging selects that box alone.
  - **The bar at the end of a box**: makes that word wider or narrower. The boxes after it on the same line move along and keep their size; the boxes before it stay. This is the quick fix when one word was much wider or narrower than estimated.
  - **The round knob under the gap between two words**: moves the boundary between them. The first word's box then ends exactly where the next one's begins; one gets more room, the other less, and nothing else moves.
  - **The square handles on the frame**: stretch or squeeze all the boxes evenly. Use the sides for a line written wider or narrower than estimated, and the top and bottom for taller or lower lines.
  - **The round handle beyond the end of the frame**: turns all the boxes about the middle of the group, for a line or a block of lines that slopes. Lift or lower it like the end of the line; hold Shift to turn finely. The angle is shown beside it. Once turned, everything else follows the slope: a box's end, a boundary or a stretch runs along the line. A single box can be turned on its own too, with the handle the image shows when it is selected.

**Undo** and **Redo** in the facsimile tools, or Ctrl+Z and Ctrl+Shift+Z while the image has the focus, take back or do again what was done to the boxes of the page: made, moved, resized or deleted. Pointing at the buttons says what they will undo or redo. This history lasts while the page is open.

Undo in the text brings back the very words it removed, with their boxes, features and normalized forms.

### Settings, export and deleting

**Settings…** changes the name, whether the transcript is diplomatic and normalized, the works the transcript is for, and its **Sources** and **Note on rights**: what it rests on, where that matters, and anything about its rights that the licence does not say, such as the rights in the text it started from. The licence itself is not chosen here: the hint under the note names it, the installation's licence that publishing will give, or the licence it was first published under (see _Licences and rights_). Sources, note and licence go into its TEI export. **Download TEI** gives the transcript as TEI XML with its pages, zones and segment labels. **Download Leiden+** gives it in the notation of papyri.info, its lines numbered and its pages as divisions, with every feature that notation has a way of writing; segments and boxes it has none for, and they are left out. **Delete…** removes it, which is refused while an edition compares it. A published transcript is open to readers at its address, read only.

## The edition

An edition is a text you edit like any other text, with variants that Varians derives by comparing it with the witnesses. Every word of the edition remembers where it came from: a witness, a conjecture, or your own hand.

### Making one

**Make New Edition**, on the front page, on Your Work and on a work's page, opens one page, and nothing is asked on another.

- **Work**: choose it from the list, which the search field narrows, or add it with **Add New Work** in a window over the page. Coming from a work's page, the work is already chosen.
- **Name of edition**, as it will be printed, and the editors' names, one in each field (**Add Editor** for another).
- **Witnesses**: **Add Witness** finds a witness in the registry, those with a transcript of the work listed first, and **Add New Witness** there registers one in a window. Each witness has the siglum it goes by in this edition, which you can change (a witness can have different sigla in different editions), and its transcript, chosen among those you may use or made with **Make New Transcript**. A witness may be without a transcript: one known only from reported readings, or one you have yet to transcribe. The arrows set the order of the witnesses.

Only the work and the name are needed; the rest can wait. **Save** makes the edition, with an empty text, and the page stays: it is from then on **Edition Settings**, where the same things are changed and, under them, the preface, the sources, the note on rights and the conventions. Beside the edition's name there, **Read** opens the reader and **Edit Text** the editor, and **Open Transcript** under a witness opens its transcript in the workbench. A work, a witness or a transcript made in a window is saved at once, being a record of its own; the edition and its settings are saved by **Save**, and leaving the page with changes not saved asks first. **Edition Settings** is also in the **⋯** menu of the editor.

The witnesses can be compared more finely, on this page and under **Witnesses and Sigla…** in the editor's **⋯** menu:

- With **Add State** under a witness, a manuscript can also be compared in further **states**, each under a siglum of its own: as first written (before correction, by default A¹), after a stage of correction (A², A³), or with the corrections of one hand (A m2); and with the variants it notes in its margins or between its lines (A v.l.). The states are derived from the deletions and additions in the transcript and the hands and stages they name (see _Features_ under Transcribing). Where a state agrees with its manuscript, only the manuscript is named. Collate only the states that matter for the witness: a manuscript with trivial corrections needs A alone; one with meaningful layers A¹ and A; one with identifiable hands a siglum per hand.
- **Groups**: a siglum that stands for several witnesses together, such as _p_ for the agreement of V and H, or for a family. Give it a siglum that no witness, state or other group has, tick at least two witnesses of the conspectus, and add a note if you like ("consensus codicum VH"). Where all its members have a reading, the variant lists them under the group's siglum with the members beside it, and where only some do it names their own sigla; the print apparatus prints the group's siglum in place of its members'. A group follows its witnesses: change a siglum and it changes in the group; take a witness out of the conspectus and it leaves its groups, and a group left with fewer than two witnesses is removed. The reader's conspectus lists the groups with their members and notes.
- **Conventions** and **Print Apparatus**, which an edition has from the start as Varians sets them and which are changed on Edition Settings: whether the paragraphs are verse or prose to begin with (any paragraph can be set otherwise in the editor, see _Verse and prose_), and how often a label is printed in verse, which are the text's; and the conventions of the **print apparatus**, which printing and the plain-text export give: a positive or negative form, Latin abbreviations (om., add., del.), and where the interpretative variants are printed (with the others, in a list of their own under the apparatus, which is the default, or not at all). The interpretative variants are always in the TEI export, marked `type="interpretative"`. Two words can stand for witnesses in the print apparatus. **The other witnesses**, _cett._ or _rell._, is printed in place of the sigla of the reading that most witnesses have at a variant, when those would be three or more; where that reading is not the edition's own, the witnesses that have the edition's reading are named, in a negative apparatus too. **All the witnesses**, _codd._, is printed where none of them has the edition's reading and all have one reading against it. With **None**, which every edition has until you choose, every witness is named. The print apparatus leaves out the minor variants and says nothing of the order of segments. It gives a variant across a boundary once, under the segment it begins in and labelled by both, and a segment the edition does not print as words added, under that segment's label. The variant window of the reader and the apparatus band of the editor use none of these devices: they name every witness.

### Bringing in the text

An edition starts without text. Type it, or bring it in from the transcripts: **Insert**, **Copy Text from Transcript…** in the editor, which an edition without text also offers where its text would be. Choose a transcript of the conspectus and, if you want only part of it, the first and last segment in **From** and **To**; left empty, they stand for the first and last segment the transcript has of the work. The window says how many segments will be copied and how many of them the edition has text for already, which the copy replaces where it stands, with any speaker, heading or note standing in the text there. Segments the edition does not have go after the segment that precedes them in the work, on lines of their own in verse and in the run of the text in prose. The words come with the transcript's line and paragraph breaks and its divided words, each word remembering the witness it was taken from.

Copy as often as you like, from one transcript for some segments and from another for others. No transcript is the edition's base: every witness is compared with the edition's words, wherever they came from. Each copy is one change in the edition's **History** and can be undone there.

### The editor

The editor has three parts. Drag the lines between them to give one more room; the editor remembers the sizes. Double-click a line to put it back as it was.

- **The text** in the middle. Type in it as in any editor; your changes are saved by themselves a moment after you stop. The status beside the title says **Saved**, **Saving…** or how many changes are waiting.
- **The apparatus band** at the foot. It shows the variants where the witnesses differ from your text, segment by segment, for the part of the text around the caret. The words of such a variant are dotted in the text, and a segment that witnesses have and your text does not print is marked: between two lines in verse, by a small point in the text in prose (see _Adopting readings_). A variant stands under the segment it begins in. A minor variant stays in the band, set apart, and its words are not dotted.
- **The side pane** on the right, with two tabs. **Witnesses** shows one witness at a time, as text (normalized, or diplomatic where the transcript has it) or as the image of the page where its words stand, following the caret, whether the words are mapped to the image or not; the mapped words of the variant are lit. The arrows under the image browse the witness's pages, and moving to another variant returns to following the words. **History** shows the history of the edition.

### Verse and prose

Every paragraph of an edition's text is verse or prose. The edition says which its paragraphs are to begin with (**Edition Settings**, _Paragraphs_), and the **Paragraph** menu at the top right of the text, beside **Insert**, sets the kind of the paragraph at the caret, or of every paragraph a selection touches: **Verse**, **Prose**, and **New Paragraph**. A paragraph that you have marked keeps its kind whatever the edition says. The kind settles how the text is shown and nothing else: segments, labels, variants and the TEI do not depend on it.

- **In verse** the lines are shown as you break them, whatever the segments are. A line may hold several segments and a segment may run over several lines, and the colometry of a lyric passage is yours. Enter breaks the line. Pressed inside a word, it divides the word: the two parts are one word, each in the segment it stands in, compared whole, and a hyphen is drawn at the end of the line. The hyphen is never typed and never kept. Joining the two lines again (Backspace at the start of the second) gives the word back whole.
- **In prose** the line breaks are not shown. The text runs on to the width of the page and breaks only at paragraphs, which are a reader's convenience, and no word is hyphenated. A segment's label stands, small, in the text where the segment begins. Enter begins a new paragraph, of the kind of this one. The line breaks stay in the text, and show again if the paragraph is marked as verse.

The reader and the history show a paragraph as the editor does: prose runs on there too.

### Adopting readings

Each variant in the apparatus band is a list, as in the reader's variant window (see _The reader_). Its head gives your words at the variant; clicking them brings the text to them and selects them. Where your text has no words and a witness has some, the head says where the variant stands (_after_ or _before_ a word of your text), and for a segment your text does not print, the segment it follows (_after 1.5_). A variant that lies across a boundary is labelled by both segments (_1.5–1.6_). Beside the head, _In 7 of 9 witnesses:_ with their sigla, or _In all 9 witnesses_, says which witnesses are there, and _Addition in_ names the witnesses in which the words are an addition.

Below stands a row for each reading, with the sigla of the witnesses that have it. Your own reading is the first row, in bold; what it rests on besides witnesses stands in it: the proposer of an adopted conjecture and what it did, marked _Adopted_, a source that only reports the reading, or _the editor_ where no witness has it. The readings of the witnesses follow, with _not in_ for the witnesses whose text runs on without the words, and a group under its siglum with its members in brackets beside it. Readings that are only reported, with the source of the report, and conjectures not yet adopted come last, each with its proposer and its references. A conjecture or a reported reading that no variant takes is listed at the foot of its segment.

In the band a variant stands under the segment it begins in, whichever passage it was collated in, and in the section of another segment its words lie in a line says _See 1.1–1.2_. **Next Variant**, **Previous Variant**, **Next to Review**, the count of variants to review, the kind, **Minor** and **Keep the Text** all follow the variant there.

- Click the words of a row to **adopt** that reading: a witness's reading, _not in_, a reported reading or a conjecture not yet adopted. The words in your text are replaced by those of the row. The adoption is recorded, and **Undo Adoption** takes it back. Your own row has nothing to adopt. Alt+1 to Alt+9 adopt the rows below it in the order the band lists them.
- A siglum shows that witness in the **Witnesses** tab of the side pane, beside the text.
- A reading in which the words are _not in_ a witness is a reading like any other: adopting it removes the words from your text, and the variant then names them an addition in the witnesses that have them. To keep words in the text but mark them as not belonging to it, register a conjecture of the kind deletion and adopt it: the words are printed in the edition's deletion brackets.
- A witness whose text runs on without a whole segment, which it has not lost, is there in the variant over the segment only, with _not in_. Adopting that row takes the segment's words out of your text, and where they stood on a line of their own, the line break with them, so that no empty line stays. A witness that has lost the segment, or whose transcript does not reach it, is in no variant of it: the band says _No text here_ with its siglum, and the reader's list of witnesses names the segments it has _no text for_. A conjecture on some words of the segment is listed at those words, also where a witness is without the whole segment, and adopting it replaces those words and not the segment. In the editor the variant over a whole segment is the active one only when the whole segment is selected, so that a conjecture on one word stays on that word.
- A segment that witnesses have and your text does not print is a variant as well: a variant at a point, listed after the segment before it in the work's numbering, which is also the segment whose passage it is collated in. Its head reads _after 1.5_; your own row reads _not in_, with the sigla of the witnesses whose text runs on without the segment, and the segment's words stand in the row of the witnesses that have it, which _Addition in_ names. A small mark shows where the segment would stand: in verse a caret (‸) in the margin between two lines, in prose a small point in the text after the last word of the segment before it. Clicking it opens the variant, which the band lists at its place; stepping to the next or previous variant, and **Next to Review**, reach it as they reach any other. Adopting its row prints the segment after the segment it follows, with its words taken from the witness chosen and in that segment: in a verse paragraph on a line of its own, in a prose paragraph in the run of the text, by the kind of the paragraph where it goes. **Undo adoption** takes it back. **Keep the Text** leaves the segment unprinted and marks the variant reviewed. Only segments between the first and the last that your text prints are reported, so that an edition of one book says nothing of the others. A segment taken out of your text, as above, is then a segment your text does not print, so that adopting its row again prints it once more; a first or a last segment removed in this way is no longer reported.
- The order of whole segments is a variant too. The band lists it at the first of its segments, after the variants of that segment: its head names the segments (_1.9–1.8_), and there is a row for each order, your own first, with the labels of the segments in that order and the sigla of the witnesses that have it. A block that stands far from its place is given by the segment it follows in each row (_after 1.20_, or _first_). Such a variant has nothing to adopt and none of the buttons that stand at the right of other heads: move lines with **Line ↑** and **Line ↓** (see _Marks, objects and notes_).
- At the right of the head of every other variant stand its kind, **Minor**, **Conjecture…** and **Keep the Text**. **Keep the Text** marks the variant as reviewed without changing anything, and then reads **Reviewed**; pressing it again marks the variant to review again. The counter at the left of the band (_3 of 12 variants to review_) says how many variants are left to review, and **Next to Review** goes to the next one; the arrows beside it (_Previous Variant_, _Next Variant_) step to the previous or the next variant of any kind. In a long edition the editor opens at once on the first segments and counts the variants of the whole text a moment later (the counter says so meanwhile); the apparatus of the segments around the caret comes as the caret reaches them.
- In the witness pane, clicking a word adopts that witness's reading at that variant.
- Each variant says whether it is **textual** or **interpretative** (see _Diplomatic and normalized_). Click the word to call the variant the other kind; it is then marked with an asterisk, and a second click goes back to what the letters say. A conjecture with other letters makes a variant textual whatever the witnesses have.
- **Minor** marks a variant as minor. It is separate from the kind: a textual variant can be minor, and so can an interpretative one. The button stays pressed while the mark holds; click it again to take the mark back. A minor variant stays in the band, set apart by a dashed line. Your text no longer dots its words, and it is no longer counted among the variants to review. The print apparatus and the plain text leave it out, and the TEI marks it `subtype="minor"`. Readers are sent it and see it only where they choose **Minor variants: Shown** in the reading settings (see _The reader_). A variant that only a conjecture opens can be marked minor too. A published version keeps the kinds and the minor variants as they were when it was published.

Every word remembers the witness it was taken from. When that witness's transcript is corrected later, the word is underlined with a wavy line and the band says, for instance, "ἄειδε: taken from A, which now reads ἄειδεν", with **Take A's reading** to follow the correction. A word you typed over is yours, and is never reported this way. **Colour words by source** tints the words that come from conjectures and from your own hand.

### Conjectures

A conjecture belongs to the work, not to your edition: once registered, every edition of the work can show it and adopt it, and the work's page lists it in the conjecture catalogue.

- Select the words the conjecture concerns and choose **Conjecture…** in the small toolbar that appears under the selection, or press Alt+C.
- Choose the kind: substitution, deletion, addition or lacuna. Type the reading, the scholar who proposed it, and, under **References**, the works where it was proposed or discussed, with pages. References come from the shared bibliography.
- **Save** records the conjecture; **Save and Adopt** also puts it into your text. A conjecture registered in an edition belongs to the edition's owner, like the edition's text, so that every collaborator sees it.
- The apparatus band shows the work's published conjectures, and the drafts you may see: your own, and the edition owner's when you collaborate. Another person's draft can be adopted once they publish it.
- A conjecture registered on the work's page that concerns words of your text appears in the apparatus band at its variant, with its proposer, and can be adopted from there.

### Marks, objects and notes

With words selected, the small toolbar under the selection offers:

- **Supplied ⟨ ⟩**, **Deleted [ ]** and **Crux †**, printed with the brackets set in the edition's conventions.
- **Line ↑** and **Line ↓**, which move whole lines, for an edition that prints its segments in another order than a witness has them. The band lists the order of segments as a variant (see _Adopting readings_), and the reader marks segments in another order, with a bracket in the margin in verse and on their labels in prose (see _The reader_).
- **Conjecture…** and **Note…**.

**Insert** at the top right of the text puts things that are not words at the caret: a speaker, a heading, a stage direction, a marginal note or a lacuna mark. A note is free text on a segment or on some of its words, with references if you want them; the reader prints notes under the apparatus.

### Publishing

**Publish** makes the edition public as it stands, as a numbered version. Readers see that version, and it stays citable when you go on editing: each published version keeps its own address, and its variants stay as they were published, compared with the witnesses as they then stood, with the kinds the editors had given them and the variants they had marked minor. **Preview** shows the reader on your current draft. **Unpublish** in the **⋯** menu takes the edition back to a draft.

Publishing an edition also publishes what it rests on, as far as it is yours: your transcripts it compares, and your conjectures and reported readings on the work. A transcript of someone else's that is still a draft cannot be published by you: publishing is refused until its owner publishes it, or you take it out of **Witnesses and Sigla…**.

Readers only ever see published versions. The working state of your edition, its history and its notes as they stand now are for you and your collaborators.

### Sources and rights

**Edition Settings** has fields for the edition's **Sources** (what it rests on beyond its witnesses: an earlier edition, a commentary) and a **Note on rights**, for what the licence does not say. The licence is not a field: the hint under the note names the installation's licence, which the first publication fixes for the edition (see _Licences and rights_), or the licence it was published under. Readers find the sources, the licence, the note and the citation under _About This Edition_, followed by a link to **Sources and Licences**, the page that lists the data and resources Varians itself uses (typefaces, dictionaries) with their licences. The page is linked from the foot of every page too. A copied edition keeps the original's sources and note until you change them, and takes its own licence when it is first published.

### Copying an edition

**Make a Copy…**, in the editor's **⋯** menu or in the reader's menu, makes a draft edition of your own:

- **From your own edition**, or one you edit: the edition as it stands now, with its editors' names.
- **From someone else's published edition**: the published version, with the witnesses it was published with. The editors' names are left for you to give. Witnesses whose transcript you may not see come without one; Varians says how many, and you can choose others under **Witnesses and Sigla…**.

The copy brings the text with every reading's source, the witnesses and sigla, the adopted conjectures, the notes and their references, the kinds the editors gave variants and the variants they marked minor, and the settings. It does not bring the history, the collaborators, the review marks or the published versions. Its reader says where it came from: _Based on_ the original, with its editors and the version copied.

## The reader

A published edition has a public page at `/editions/` followed by its address, such as `/editions/iliad-1`. It shows the published version to everyone; its editors also see the draft through **Preview** in the editor.

- The text is set with its labels in the margin, and variants are marked where they stand. A paragraph of verse is set in the lines the edition breaks, a divided word ending its line with a hyphen. A paragraph of prose runs on to the width of the page, with no hyphen; the label of its first segment stands in the margin, and the others stand small in the text where their segments begin. Words where the witnesses differ have a dotted underline. Where the edition has no words and a witness has some, a small caret stands in the space after the word before them.
- Variants over whole segments are marked by the kind of the paragraph their segments are shown in. **In verse** they are marked in the margin, between the labels and the words: a rule along a segment that some witnesses do not have, a caret between two lines for a segment that the edition does not print, and a bracket along segments that some witnesses have in another order (a block far from its place is marked along the block). Marks over the same lines stand side by side. **In prose** there are no lines to mark, and these variants are marked in the text like any other: the words of a segment that some witnesses do not have are dotted, a segment that the edition does not print has the small caret in the space after the word before it, and segments in another order have their labels dotted. A stretch that runs over paragraphs of both kinds is marked in each by that paragraph's kind. Click or tap a mark, a word or a label, or reach it with Tab and press Enter, to open its **variant window**. The marks are not printed.
- The **variant window** is a list of what the witnesses have there. It begins with the label of the passage (_1.5_, or _1.5–1.6_ where the variant lies across a boundary) and the edition's words, with _minor_ or _interpretative_ where the variant is that; where the edition has no words it names the word the variant follows, or for a segment the edition does not print the segment it follows. Then it says which witnesses are there: _In 7 of 9 witnesses:_ with their sigla, or _In all 9 witnesses_. Where the words are an addition, _Addition in_ names the witnesses that have them: those where the edition does not print the words and witnesses have them, or where the edition prints them as deleted. Then come the readings, one row for each, with the sigla of the witnesses that have it. The edition's reading is the first row, in bold, and what it rests on besides witnesses stands in it: the proposer of an adopted conjecture and what it did, a source that only reports the reading, or _the editor_ where the reading is the editor's own. Where a witness has no words, its row says _not in_; where the edition has no words and no witness agrees, the first row says _not in the edition_. A group stands under its siglum with its members in brackets beside it. Readings known only from a report, and conjectures, follow with their sources, proposers and references; the editor's notes on the words come last. Where a witness has the words in another spot nearby, its row leads to the variant there, which leads back. A link goes to the first of the segments the variant lies in. Every siglum is a button that opens that witness in the **Witnesses** panel with the words lit.
- **Variants**, in the bar above the text, opens a panel that lists the variants of the segments in view, each as the window gives it, in a compact form, so that a whole page can be followed; variants over whole segments stand in it at their place. Pointing at a variant lights its words in the text; clicking it goes there and opens its window.
- **Reading Settings** (the gear) change the text size and the **Segment labels**, _As in the edition_ or _Every segment_. **Minor variants** (_Shown_ or _Not shown_) says whether the variants that the editor marked minor are marked and listed; they are not shown to begin with. **Mark words with variants** draws or hides the dotted lines and the marks; the words still open their variants. The settings can also show the print apparatus on screen, below or beside the text, in its concise form with sigla, positive or negative, and put the interpretative variants with the others, in a list of their own, or out of sight, whatever the edition does. The settings are remembered in your browser. Printing always gives the print apparatus, which leaves out the minor variants.
- On a wide screen the panels stand beside the text; drag their left edge to make them wider or narrower.
- **Witnesses** opens the conspectus siglorum, with the edition's groups of sigla and, for each witness, the segments it has _no text for_, and the text of any witness beside the edition, with the words of the open variant lit. Where the witness's transcript is diplomatic as well as normalized, a switch shows its **Diplomatic** text: how the witness writes the words that the variants compare. A stretch that the transcript marks as lost or illegible shows as […], and one marked as not transcribed as (not transcribed). **Facsimile** shows the page of the manuscript where those words stand, whether or not they are mapped to the image (the mapped ones are lit), with the image's credit line and rights statement under it.
- **Dictionary** (in Greek editions) looks up any word you click while it is open, or one you type: its possible lemmas and grammar, from the treebanks and the Morpheus analyses, and the entries of the lemma in Liddell, Scott and Jones and in the Middle Liddell, each marked with its dictionary and licence. A word with variants opens its variant window as well.
- **Search** finds words regardless of accents and steps through the matches.
- The menu offers the edition as plain text with its print apparatus and as TEI XML, and lists the published versions. The TEI has the variants over the edition's words, the interpretative ones marked `type="interpretative"` and the minor ones `subtype="minor"`; the plain text has the print apparatus, which leaves the minor variants out. In the TEI a segment is an address and encloses nothing: it begins at a milestone that carries its label, so a word or a variant that lies across two segments is written whole, with the start of the second segment inside it. The TEI also has the conjectures and the reported readings, each pointing at who proposed it and at what it cites, and the works the edition cites as a bibliography in its header. Each version keeps its address, `/editions/iliad-1/v/2`, and reads exactly as it was published: its variants do not change when a witness is corrected later. A passage has its own address too, such as `/editions/iliad-1/1.5`.
- Printing gives the text with its print apparatus, without the controls and the marks.
- _About This Edition_, at the foot of the page, gives the edition's sources, its licence, its editors' note on rights, and **How to cite** the version shown (see _Licences and rights_).

## History

Every change to a transcript or an edition is kept, with who made it and when. Nothing needs to be switched on. Open the **History** tab beside the text.

### Moments

The **Moments** list shows the history newest first, gathered into sessions: one person's work without a long pause, such as "Iris Second, Today, 14:02 to 14:40, 3 words added, 1 changed". Named moments carry a bookmark, and published versions say **Published**.

- Click a moment to see the text as it stood then, with the changes since the moment before marked: added words underlined, removed words struck through where they stood, re-spelt words underlined faintly with the old spelling shown when you point at them, and moved words with a small arrow. Each person's changes have their own colour. **Changes since** compares with any earlier moment instead. An edition's text is set as the reader sets it: a paragraph of prose runs on, with the label of each segment in the run and no hyphen in a divided word, and a line break inside it that a change touched is marked where it stood; a word that the end of a line of verse divides has its hyphen drawn.
- **Name This Moment** gives the moment a name, such as "before the collation", so that you find it again.
- **Bring the Text Back as It Was** restores the whole text to that moment, as a new change of yours. Nothing is lost: the history keeps everything, and bringing back can itself be undone.
- **Show the changes** under a session lists its single changes; **Undo This Change** takes one back. When later changes touched the same words, Varians names them and asks before it undoes what it can.

### Review

The **Review** tab lists what others changed since you last reviewed, each change with its author, its time, and the lines it touched before and after.

- **Accept** marks a change as seen and good.
- **Reject** undoes it.
- **Later** leaves it for another time.
- **Review from** starts the review at a named moment or a version, for instance from the last published version.

## Working together

The owner of an edition invites collaborators from the **⋯** menu with **Collaborators…**, by the email address of their account. Collaborators edit the edition, the transcripts it compares that belong to the owner, and the owner's conjectures on the work. Only the owner publishes, invites and deletes.

**Offer Ownership…** hands an edition to someone else. Ownership moves when that person accepts the offer on their account page; the former owner stays on as a collaborator.

Two people may edit the same text at the same time. When both change the same words, the change saved first stands, and the other person is told that theirs was set aside. When a page is removed from the witness, or the pages are put in another order, while you are typing, what you typed is saved all the same and follows the pages: the text of a page that is gone is in Not on a page, the status line says so, and the History shows the change as _Pages reorganized_.

## The bibliography

The bibliography is shared by everyone on the installation and kept in biblatex, the format of most reference managers. Open it from the header.

- **Import .bib…** reads a file exported from Zotero, JabRef or any other reference manager. Entries with new keys are added. Your own entries with a key that already exists are updated; entries someone else added are left as they are.
- **Add New Entry…** takes one biblatex entry. The label the apparatus cites by, such as "West 1998", is made from the names and the year.
- **Download .bib** gives you the whole bibliography back.
- An entry that something cites cannot be deleted until the citations are removed.

Conjectures, reported readings and notes cite entries under **References**: search by author, title or year, choose the entry, and add what comes before it ("cf.") and the pages after it. An edition's works cited are the entries that its apparatus and notes cite.

## The archive

Varians keeps a copy of every work outside its database, in open formats, so that the work outlives the program. For each work the server keeps a git repository with:

- the work, its reference scheme, its segments and its witnesses as JSON, with the segments also as a table, each with its CTS URN where the work has one;
- every transcript as TEI XML, with the facsimile zones;
- every edition as TEI XML with a critical apparatus, and as plain text and Markdown for reading without any tools;
- the token streams, adoptions, notes, the editors' alignment constraints, the variants looked at, the kinds the editors gave variants and those they marked minor, and the full history of changes as JSON, for what TEI cannot carry exactly;
- the bibliography as `.bib`, and the images as their original files;
- a README saying where the format is specified.

Every record of the work is in the archive, so that the work can be rebuilt from it alone. A change is in the archive's files within a minute of the last save. A commit marks every named moment and every publication, in the name of the person who made it, and the rest is committed every night. Anyone signed in who can see the work downloads it from the work's page as a **package**, a few times an hour, holding what that person may see: an edition they do not edit comes as its published version, and no one's review positions are included. An administrator may also download the server's repository itself, with its history.

A package is a zip holding one or more archives, with a checksum for every file and a description of its contents (BagIt and RO-Crate, which libraries and repositories read). Besides the work's, the reader of an edition offers the edition's package under _Download_: the work's own files, the witnesses and transcripts of its conspectus at the versions its published apparatus was made from, and the bibliography it cites. A transcript has a package of its own at `/transcriptions/<id>/package.zip`, and an administrator exports the whole installation from the users page.

**Import** in the menu under your name brings in a package or an archive, from this installation or another. It first checks the checksums and the files, and shows what it would do: which transcripts and editions are new, which are brought up to date, which have changes on both sides that go together, and which have been changed on both sides in the same words, or so that a word would pass into another segment than either side gave it, for which you choose whether to leave them, keep yours or take theirs. Only then does it import. What you may not edit here is left as it is, and what the package brings in becomes yours; the people who made it are named as they were. A package whose licence may not be published here is refused: records under CC BY-SA 4.0 go only to an installation that publishes under CC BY-SA 4.0.

A work can be kept in step with its copy on another installation of Varians. Its maintainers add the other installation under **Other Installations** on the work's page, by the address of the work there. **Compare** shows which transcripts and editions differ; **Look at What a Pull Would Do** shows what bringing the other side's changes here would do, as an import does, and then brings them; **Send Changes There** sends this side's package, which the other installation takes in keeping its own text wherever the two conflict, so that conflicts are resolved by pulling first. A work's published records are pulled without more; drafts and sending need a token of your account on the other installation, which you make on your account page there under **Tokens**. A pull may be repeated every so many hours; conflicts it meets are left for a maintainer.

Every record has a lasting address, `/id/<id>`, which leads to its page; a word's address opens its transcript or edition at that word. The TEI uses these addresses for the words an edition takes from its witnesses, and another program can ask an address for the record as the archive holds it.

The files follow the **Varians Data Format**, whose specification, JSON Schemas and TEI customization every installation serves at [/formats](/formats). `pnpm --filter @varians/web cli import-archive <folder> --user <email>` reads an archive back into an installation, which is also how a work moves from one installation to another. A work already here is brought up to date, never overwritten: a transcript or edition changed only on the other side takes those changes; one changed on both sides in different places takes both, as one change that names what it brings in; one changed on both sides in the same words is left as it is and reported with its segments, and imported again with `--on-conflict keep` (yours stays, theirs is kept in the history unapplied) or `--on-conflict take` (theirs replaces yours, and your state is kept as a moment called "Before import"). `--dry-run` shows what would happen and changes nothing. People are recognized by their ORCID iD; those unknown here are recorded under their names, without an account.

## Licences and rights

### Publishing

Publishing an edition or a transcript licenses it under the data licence of the installation: CC BY-SA 4.0 on varians.eu, or CC0 1.0 or CC BY 4.0 where an installation has chosen so. The licence is fixed at the first publication and stays with the record: unpublishing and publishing again, later versions, or a later change of the installation's licence do not change it. Conjectures, reported readings and notes published with a work fall under the same licence. The reader names the licence, linked to its text, and the TEI and the archive carry it with every published record. What you write in the **Note on rights** of a transcript or an edition is shown beside the licence: the rights in a text you started from, say, or a request about how the work is to be credited. It adds to the licence and cannot take anything from it.

You keep the rights you have in what you contribute; the licence is non-exclusive. The **terms of contribution**, at [/terms](/terms), say this and the rest in full: what publishing licenses, that a text you start from must be in the public domain or openly licensed (its history is published with your work), and what you promise about images. They are accepted at registration, and again before you next edit or publish when a new version of them comes into force.

### The registry

Works, witnesses, segments, reference schemes and bibliography entries are dedicated to the public domain under CC0 1.0, whoever registers them, so that the descriptions of manuscripts and works can be used, corrected and copied without conditions, here and elsewhere.

### Images

Every page image carries its own **rights statement**, chosen from a fixed list: the Public Domain Mark, the CC0 dedication, the six Creative Commons 4.0 licences (CC BY, CC BY-SA, CC BY-ND, CC BY-NC, CC BY-NC-SA, CC BY-NC-ND), and the statements of RightsStatements.org (No Copyright, Non-Commercial Use Only; No Copyright, Other Known Legal Restrictions; In Copyright; In Copyright, Educational Use Permitted; In Copyright, Non-Commercial Use Permitted; Copyright Not Evaluated; Copyright Undetermined; No Known Copyright). With it go the **credit line** the holder of the rights asks for, and the **source**, the address the image came from. Give the statement the holder gives: a library's manifest usually states it, and the IIIF import keeps it (see _Pages and images_).

The statement decides whether the image travels with the work. Images under the Public Domain Mark, CC0, a Creative Commons licence or one of the two No Copyright statements are copied into the archive and into every download of the work. Images under any other statement (In Copyright and its variants, Copyright Not Evaluated, Copyright Undetermined, No Known Copyright), and images without a statement, are shown here but not copied: the archive names their source instead, and the zones drawn on them are kept all the same, so that the mapping of words to the page survives and the image can be fetched again from its holder. The form says so when such a statement is chosen.

Wherever a page image is shown, in the facsimile pane, the reader, the editor's witness pane and the page viewer, its credit line and its rights statement stand under it, the statement linked to its text.

### How to cite an edition

_About This Edition_, at the foot of the reader, gives a citation of the published version shown, under **How to cite**: the editors as listed on the edition, the title, the version and the date of its publication, its lasting address (`/editions/iliad-1/v/2`, which always reads as that version was published), and the licence. Cite that address rather than the edition's plain address, which shows the latest published version. A passage is cited by the version's address followed by the passage, such as `/editions/iliad-1/v/2/1.5`.

## Keyboard

In the edition editor:

| Keys                     | Action                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| Alt+↓, Alt+↑             | next or previous variant                                           |
| Alt+N                    | next variant still to review                                       |
| Alt+1 to Alt+9           | adopt the first to ninth row below your own at the caret's variant |
| Alt+K                    | keep the text: mark the variant as reviewed                        |
| Alt+C                    | register a conjecture on the selected words                        |
| Alt+I                    | insert a speaker, heading, note or lacuna at the caret             |
| Alt+Shift+↑, Alt+Shift+↓ | move the selected lines up or down                                 |
| Ctrl+Z, Ctrl+Shift+Z     | undo and redo (Cmd on a Mac)                                       |

Everywhere a pane can be resized, the line between the panes takes the keyboard too: reach it with Tab, move it with the arrow keys (with Shift in larger steps), and press Enter to put it back as it was.

In the workbench:

| Keys                       | Action                                     |
| -------------------------- | ------------------------------------------ |
| Ctrl+Shift+U               | unclear                                    |
| Ctrl+Shift+S               | supplied                                   |
| Ctrl+Shift+D               | deleted                                    |
| Ctrl+Shift+A               | added                                      |
| Ctrl+Shift+B               | abbreviation                               |
| Ctrl+Shift+G               | gap (text lost or illegible)               |
| Ctrl+Shift+L               | segment label at the caret                 |
| Alt+Page Down, Alt+Page Up | next or previous page, Not on a page first |
| Ctrl+X, then Ctrl+V        | move the selected words to the caret       |
| Enter                      | new line                                   |
