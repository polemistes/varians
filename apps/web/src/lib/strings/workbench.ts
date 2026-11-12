/**
 * Every user-facing string of the transcription workbench.
 * Plain English, no em dashes. Components import `workbench` from
 * '$lib/strings/workbench'.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const workbench = {
  title: (siglum: string, witness: string, name: string) => `${siglum} · ${witness} · ${name}`,
  backToWitness: (witness: string) => `Back to ${witness}`,
  readOnly: 'Read Only',
  readOnlyHint: 'You can read this transcript but not change it.',
  draft: 'Draft',
  published: 'Published',

  form: {
    label: 'Form Shown',
    written: 'Diplomatic',
    read: 'Normalized',
    writtenHint: 'The text as the witness writes it',
    readHint: 'The text normalized',
  },

  pages: {
    label: 'Page',
    previous: 'Previous Page',
    next: 'Next Page',
    choose: 'Choose a Page',
    /** The text on no page of the witness. */
    unplaced: 'Staging',
    unplacedWords: (n: number) => plural(n, 'word', 'words'),
    whole: 'Whole Text',
    wholeHint: 'Every page in one view, read only; double-click a word to open its page',
    /** The title of the mark beside a page with text in this transcript. */
    hasText: 'Has text in this transcript',
    manage: 'Pages',
    manageHint: 'Every page of the witness, with its image, in the side pane',
    /** After a save: the witness's pages changed meanwhile, and the text was made to follow them. */
    reorganized: 'Pages reorganized',
    pageGone: 'A page was removed from the witness; its text is in Staging',
  },

  /** Moving text between pages. */
  move: {
    to: (label: string) => `Move to ${label}`,
    toTitle: 'Move the selected words to the end of this page’s text',
    other: 'Move to…',
    otherTitle: 'Move the selected words to another page, or to Staging',
    moved: (label: string) => `Moved to ${label}`,
    show: 'Show',
    /** The facsimile's own page chooser in Staging. */
    facsimilePage: 'Page Shown beside the Text',
    notMappable: 'Words in Staging cannot be mapped',
    notMappableWhole: 'Open the page to map its words',
  },

  tools: {
    label: 'Tools',
    title: 'Import, number lines, normalize diacritics, remove marks, change case',
    import: 'Import…',
    numberLines: 'Number Lines from Here…',
    scopeSelection: (n: number) => `For the ${n === 1 ? 'selected word' : `${n} selected words`}`,
    scopePage: 'For every word of the page shown (select words to act on fewer)',
    normalize: 'Normalize Diacritics',
    normalizeHint:
      'Accents, breathings and diaereses of the normalized forms, from the analyser. Where one form fits it is set; the others are marked for you to choose.',
    normalizeHintOneForm:
      'Accents, breathings and diaereses of the words, from the analyser. Where one form fits it is set; the others are marked for you to choose.',
    removeHeading: 'Remove from the Diplomatic Text',
    removeHeadingOneForm: 'Remove from the Text',
    removeAccents: 'Accents',
    removeBreathings: 'Breathings',
    removeDiaereses: 'Diaereses',
    removeIotaSubscripts: 'Iota Subscripts',
    removeAll: 'All Four',
    caseHeading: (diplomatic: boolean) =>
      diplomatic ? 'Case of the Diplomatic Text' : 'Case of the Text Shown',
    lower: 'All Lower Case',
    upper: 'All Upper Case',
    changed: (n: number) => `${plural(n, 'word', 'words')} changed.`,
    nothingChanged: 'Nothing to change.',
    failed: 'The analyser could not be reached.',
    normalized: (set: number, choose: number, unknown: number) =>
      [
        `${plural(set, 'word', 'words')} normalized`,
        choose ? `${choose} to choose` : '',
        unknown ? `${unknown} unknown to the analyser` : '',
      ]
        .filter((x) => x)
        .join(', ') + '.',
    takeFrom: 'Take Normalized Forms from Another Text…',
    takeFromHint:
      'Where a word has the same letters as the word it stands against in another transcript or an edition, its form there.',
    take: {
      title: 'Take Normalized Forms from Another Text',
      description: (n: number | null) =>
        `${n ? `For the ${n === 1 ? 'selected word' : `${n} selected words`}` : 'For every word of the page shown'}: where a word has the same letters as the word it stands against in the text chosen, it takes that text's normalized form, accented for its place here. Words with other letters are textual variants and are left alone.`,
      source: 'Text',
      transcription: 'Transcript',
      edition: 'Edition',
      loading: 'Finding the texts of the work',
      none: "There is no other text of this transcript's works that you may see.",
      failed: 'The other text could not be read.',
      take: 'Take the Forms',
      cancel: 'Cancel',
      done: (taken: number, differing: number) =>
        `${plural(taken, 'word', 'words')} took the other text's form${differing ? `; ${plural(differing, 'word stands', 'words stand')} against other letters, left alone` : ''}.`,
    },
    choose: {
      label: 'Choose the Form',
      several: 'The letters can be several words:',
      disagrees: 'No form agrees with the accents the witness writes. Choose one:',
      unknown: 'The analyser does not know this word. Type its normalized form in the text.',
      keep: 'Leave as It Is',
      previous: 'Previous Word to Choose',
      next: 'Next Word to Choose',
      count: (n: number) => `${plural(n, 'word', 'words')} to choose`,
    },
  },

  insert: {
    label: 'Insert',
    title: 'Insert a break or an object where the caret is',
    breaksHeading: (line: number) => `Before Line ${line}`,
    column: 'Column Break',
    paragraph: 'Paragraph Break',
    /** What a break would do, shown under it. */
    begins: {
      column: (line: number) => `Line ${line} will begin a new column`,
      paragraph: (line: number) => `Line ${line} will begin a new paragraph`,
    },
    /** Why a break cannot be made there. */
    pageStart: (line: number) => `Line ${line} is the first of the page`,
    already: {
      column: (line: number) => `Line ${line} begins a column already`,
      paragraph: (line: number) => `Line ${line} begins a paragraph already`,
    },
    objectsHeading: 'At the Caret',
    gap: 'Gap',
    gapHint: 'Text lost or illegible',
    notTranscribed: 'Not Transcribed',
    space: 'Space',
    spaceHint: 'Left blank by the scribe',
    figure: 'Figure',
    note: 'Note',
    noCaret: 'Click in the text to choose where.',
  },

  /** The header's view controls: the side pane. */
  menu: {
    togglePane: 'Show or Hide the Side Pane',
    /** A pressed button: the side pane stands left of the text. */
    paneLeft: 'Facsimile on the Left',
  },

  pane: {
    label: 'Side pane',
    resize: 'Resize the Side Pane',
    facsimile: 'Facsimile',
    otherForm: 'Other Form',
    history: 'History',
    pages: 'Pages',
    otherWritten: 'The diplomatic text, not editable here',
    otherRead: 'The normalized text, not editable here',
    asWritten: 'Diplomatic, without word division',
  },

  status: {
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: (n: number) => `${n} unsaved`,
    notSaved: (message: string) => `Not saved: ${message}`,
    retry: 'Try Again',
    lines: (n: number) => plural(n, 'line', 'lines'),
    unmapped: (n: number) => `${plural(n, 'word', 'words')} unmapped`,
    unchecked: (n: number) => `${plural(n, 'word', 'words')} to check`,
    proposals: (n: number) => `Normalized Forms Proposed (${n})`,
    wholeText: 'whole text',
    /** Words on no page, in the status line of a page or the whole text. */
    unplaced: (n: number) => `${plural(n, 'word', 'words')} in Staging`,
    readOnly: 'Read only',
    leaveWarning: 'Changes are still being saved. Leave anyway?',
  },

  conflict: {
    title: 'Someone else changed this text',
    body: (n: number) =>
      n === 1
        ? 'Their changes are shown. One change of yours touched the same words and was set aside:'
        : `Their changes are shown. ${n} changes of yours touched the same words and were set aside:`,
    words: (list: string) => `words: ${list}`,
    removed: (n: number) => `${plural(n, 'removal', 'removals')}`,
    other: (n: number) => `${plural(n, 'other change', 'other changes')} (marks, joins, segments)`,
    dismiss: 'Dismiss',
  },

  toolbar: {
    label: 'Selection Tools',
    actions: 'Map and Confirm',
    map: 'Map',
    mapTitle: 'Draw the selected words on the facsimile',
    confirm: 'Confirm',
    confirmTitle: 'Confirm the normalized forms of the selected words as they stand',
    numberLines: 'Number Lines…',
    variant: 'Variant…',
    variantTitle:
      'Note a variant the manuscript gives for the selected words, in the margin or between the lines',
    editVariant: 'Edit Variant…',
    removeVariant: 'Remove Variant',
    removeVariantTitle: 'Remove the variant noted on these words',
    correction: 'Correction…',
    correctionTitle: 'Say which hand made the selected deletion or addition, and at which stage',
    segment: 'Segment…',
    segmentTitle: 'Set the segment that begins at the first selected word',
  },

  /** The hand of a correction or a noted variant. */
  hands: {
    notKnown: 'Not known',
    scribe: 'The scribe',
    other: 'Another hand',
  },

  correction: {
    title: 'Correction',
    kinds: { del: 'Deletion', add: 'Addition' } as Record<string, string>,
    hand: 'Hand',
    stage: 'Stage',
    stageHint:
      'The order of the layers of correction: 1 for the first, 2 for the next. An edition can collate the text after any stage.',
    save: 'Save',
    cancel: 'Cancel',
  },

  variant: {
    title: 'Variant Noted in the Manuscript',
    description:
      'Stays with this witness; an edition can collate it under a siglum of its own (A v.l.).',
    words: 'For the words',
    reading: 'Reading',
    readingHint: 'Empty if the variant leaves the words out.',
    place: 'Where it stands',
    places: {
      margin: 'In the margin',
      interlinear: 'Between the lines',
      other: 'Elsewhere',
    } as Record<string, string>,
    hand: 'Hand',
    save: 'Save',
    cancel: 'Cancel',
  },

  segment: {
    title: 'Segment',
    label: 'Label',
    hint: (example: string) => `As the work numbers it, for example ${example}.`,
    part: 'Part',
    partHint: (n: number) =>
      `This segment already begins elsewhere in the text; this is its part ${n}.`,
    set: 'Set',
    unassign: 'Unassigned from Here',
    remove: 'Remove This Start',
    cancel: 'Cancel',
    invalid: (label: string) => `${label} is not a label of this work.`,
    failed: 'The segment could not be set.',
  },

  /** The work text is assigned to, where segments are named, lines numbered and text imported. */
  workField: {
    label: 'Work',
    another: 'Choose another work',
    search: 'Search the works',
    failed: 'The work could not be loaded.',
  },

  numbering: {
    title: 'Number Lines',
    description:
      'Each line from the caret to the end of the page gets the next label on its first word.',
    start: 'First Label',
    count: 'Lines',
    countHint: 'Leave empty to number to the end of the page.',
    run: 'Number',
    cancel: 'Cancel',
    nothing: 'There are no lines to number from the caret.',
    done: (n: number) => `${plural(n, 'line', 'lines')} numbered.`,
    stopped: (label: string) => `No label follows ${label}; numbering stopped there.`,
  },

  proposals: {
    title: 'Normalized Forms Proposed',
    description:
      'From the normalization profile and the forms you confirmed before. Accepting remembers each pair.',
    scope: 'Where',
    page: 'This Page',
    whole: 'Whole Text',
    written: 'Diplomatic',
    proposed: 'Normalized',
    source: 'From',
    memory: 'memory',
    profile: 'profile',
    all: 'Select All',
    none: 'Select None',
    accept: (n: number) => (n === 1 ? 'Accept 1' : `Accept ${n}`),
    cancel: 'Cancel',
    empty: 'Nothing to propose here.',
    accepted: (n: number) => `${plural(n, 'normalized form', 'normalized forms')} accepted.`,
    confirmed: (n: number) => `${plural(n, 'normalized form', 'normalized forms')} confirmed.`,
  },

  facsimile: {
    noPage: 'This view has no page. Choose a page to see its image.',
    noImage: (label: string) => `Page ${label} has no image yet.`,
    addImage: 'Add an Image…',
    addImageHint: (maxMb: number) =>
      `JPEG, PNG, TIFF or WebP, up to ${maxMb} MB. You can also drop the file here.`,
    dropHere: 'Drop the image here',
    allPages: 'All Pages',
    uploading: (percent: number) => `Uploading ${percent}%`,
    processing: 'Making tiles',
    tools: 'Mapping Tools',
    shape: 'Shape to Draw',
    pan: 'Move',
    rect: 'Rectangle',
    polygon: 'Polygon',
    mapSelection: 'Map Selection',
    mapSelectionHint: 'Select words in the text, then draw a rectangle or polygon around them.',
    mapLines: 'Map Lines',
    mapLinesHint: 'Select whole lines in the text, then draw one box around them on the image.',
    feature: 'Feature',
    featureHint:
      'With no words selected, a shape you draw marks a feature: a figure, damage, a marginal mark.',
    showUnmapped: 'Light unmapped words',
    showBoxes: 'Show all boxes',
    drawPrompt: {
      selection: (n: number) => `Draw around the ${plural(n, 'selected word', 'selected words')}.`,
      lines: (n: number) =>
        `Draw one box around the ${plural(n, 'selected line', 'selected lines')}.`,
      noLines: 'Select the lines to map in the text first.',
      area: 'Draw around the boxes to select. A box is taken when its middle lies inside.',
      feature: 'Draw the feature on the image.',
    },
    detecting: 'Finding the lines…',
    mapped: (n: number) => `${plural(n, 'zone', 'zones')} made.`,
    linesFound: (found: number, wanted: number) =>
      found === wanted
        ? `The image shows ${plural(found, 'line', 'lines')}, as the text has.`
        : `Divided evenly: the image showed ${found} lines, the text has ${wanted}.`,
    failed: 'The zones could not be saved.',
    select: {
      label: 'Select',
      line: "The Boxes of the Caret's Line",
      all: (n: number) => `All Word Boxes on This Page (${n})`,
      area: 'Boxes in an Area…',
      none: 'None',
    },
    picked: (n: number) =>
      n ? `${plural(n, 'box', 'boxes')} selected.` : 'No box stands in that area.',
    undo: 'Undo',
    redo: 'Redo',
    history: {
      move: (n: number) => `move ${plural(n, 'box', 'boxes')}`,
      resize: (n: number) => `resize ${plural(n, 'box', 'boxes')}`,
      turn: (n: number) => `turn ${plural(n, 'box', 'boxes')}`,
      made: (n: number) => `make ${plural(n, 'box', 'boxes')}`,
      deleted: (n: number) => `delete ${plural(n, 'box', 'boxes')}`,
      undoTitle: (what: string) => `Undo: ${what} (Ctrl+Z on the image)`,
      redoTitle: (what: string) => `Redo: ${what} (Ctrl+Shift+Z on the image)`,
      nothing: 'Nothing to undo on this page',
      nothingRedo: 'Nothing to redo on this page',
      undone: (what: string) => `Undone: ${what}.`,
      redone: (what: string) => `Done again: ${what}.`,
    },
    delete: {
      label: 'Delete',
      selected: (n: number) => (n ? `The Selected Boxes (${n})` : 'The Selected Boxes'),
      orphans: (n: number) => `Boxes Whose Words Are Gone (${n})`,
      all: (n: number) => `All Word Boxes on This Page (${n})…`,
      confirmTitle: 'Delete All Word Boxes on This Page?',
      confirmBody: (n: number, page: string) =>
        `${plural(n, 'word box', 'word boxes')} on ${page} will be deleted. Features stay. Undo brings the boxes back as long as the page stays open.`,
      confirm: (n: number) => `Delete ${plural(n, 'Box', 'Boxes')}`,
      cancel: 'Cancel',
    },
    deletedMessage: (n: number) =>
      `${plural(n, 'box', 'boxes')} deleted. Undo brings ${n === 1 ? 'it' : 'them'} back.`,
    group: {
      label: 'The selected boxes',
      keys: 'The arrow keys move the selected boxes; with Shift, ten times as far',
      hint: (n: number) =>
        `${n} boxes selected, each labelled with its word. Drag a box to move them all. The bar at the end of a box resizes it, and the boxes after it on its line follow. The round knob under the gap between two words moves the boundary between them, and nothing else. The square handles on the frame stretch or squeeze all the boxes; the round handle beyond its end turns them, for sloping lines (hold Shift to turn finely). Shift-click a box to add or remove it; Escape lets go. Delete removes the boxes while the image has the focus; in the text, it removes the words.`,
      turn: 'Turn the boxes, for lines that slope. Hold Shift to turn finely.',
      resize: (word: string) =>
        `Resize “${word}”: the boxes after it on its line follow, keeping their size`,
      boundary: (a: string, b: string) =>
        `Move the boundary between “${a}” and “${b}”: one gets more room, the other less, and nothing else moves`,
      side: {
        left: 'Stretch or squeeze the boxes from the left',
        right: 'Stretch or squeeze the boxes from the right',
        top: 'Make the boxes taller or lower from the top',
        bottom: 'Make the boxes taller or lower from the bottom',
      },
    },
    controls: { zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fit: 'Fit the Page', controls: 'Zoom' },
    zones: (n: number) => plural(n, 'zone', 'zones'),
  },

  feature: {
    title: 'A Feature of the Page',
    kind: 'Kind',
    description: 'Description',
    save: 'Save',
    cancel: 'Cancel',
    kinds: {
      figure: 'Figure or Illustration',
      decoration: 'Decorated Initial or Ornament',
      damage: 'Damage or Hole',
      marginalia: 'Marginal Mark or Note',
      other: 'Other',
    } as Record<string, string>,
  },

  importer: {
    title: 'Import',
    description:
      'The import is one change in the history. Text is added at the end of the place chosen, or of the pages of the witness the file names; an empty transcript is replaced.',
    tabs: { tei: 'TEI', text: 'Plain Text', leiden: 'Leiden', layout: 'PAGE or ALTO' },
    replace: 'Replace the whole text',
    replaceHint: 'Instead of adding to what is there. The history keeps the old text.',
    placement: 'Place',
    placementUnplaced: 'Staging',
    placementPage: (label: string) => `On ${label}`,
    placementTei:
      'The text of page breaks that name pages of the witness goes to those pages; the rest goes here.',
    source: 'Source of the Transcript (optional)',
    sourceHint: "Added to the transcript's sources.",
    /** What the file is: the two are read differently. */
    kind: 'The file is',
    kindText: 'A text to start from',
    kindTextHint:
      'Its words and their numbering are taken and nothing else, as if typed in: it is yet to be corrected against the witness.',
    kindTranscript: 'A transcript of this witness',
    kindTranscriptHint:
      'Its features and pages are kept. What its editor supplied is left out, and the gap kept.',
    noWork: 'No work: the text comes in without segment labels.',
    file: 'File',
    or: 'or',
    tei: {
      source: 'URL or CTS URN',
      sourceHint: 'A TEI file on the web, or a CTS URN.',
      preview: 'Read the File',
      reading: 'Reading…',
      structure: 'Structure Found',
      unit: 'Unit',
      count: 'Count',
      example: 'Example',
      level: 'Level',
      ignore: 'Not Used',
      resolved: (n: number, of: number) => `${n} of ${of} numbered places give labels`,
      examples: (list: string) => `for example ${list}`,
      words: (n: number) => plural(n, 'word', 'words'),
      pageBreaks: (n: number) => plural(n, 'page break', 'page breaks'),
      titleFound: (title: string) => `Title: ${title}`,
      needSource: 'Choose a file, or give a URL or a CTS URN.',
      needKind: 'Say what the file is: a text to start from, or a transcript of this witness.',
    },
    text: {
      text: 'Text',
      numbering: 'Numbering',
      none: 'No numbering',
      kinds: {
        'line-start-number': 'A number at the start of a line',
        bracketed: 'A number in brackets',
        'every-line': 'Every line is a segment',
        'margin-every-n': 'Numbers in the margin every few lines',
      } as Record<string, string>,
      matches: (n: number, sample: string) => `${plural(n, 'match', 'matches')}, first ${sample}`,
      start: 'First Label',
      startHint:
        'The label of the first line, for numbering every line or the lines before the first number.',
      paragraphs: 'A blank line is a paragraph',
      hyphens: 'A hyphen at the end of a line divides a word',
    },
    leiden: {
      text: 'Text in Leiden Notation',
      hint: 'A transcript of this witness in Leiden+, as papyri.info writes it, or in the conventions as printed. What its editor supplied in [ ] or < > is left out, and the gap kept.',
    },
    layout: {
      file: 'PAGE XML or ALTO File',
      hint: 'From Transkribus, eScriptorium or another recognition tool. Pages are matched to the witness by label or file name.',
      createPages: 'Pages the witness lacks are added to it.',
      noCreatePages: 'Pages the witness lacks are not added: you do not maintain this witness.',
    },
    run: 'Import',
    running: 'Importing…',
    cancel: 'Cancel',
    done: 'Imported.',
    summary: (o: {
      segments: number;
      pagesMatched: number;
      pagesCreated: number;
      zones: number;
      unplaced?: number;
    }) =>
      [
        o.segments ? plural(o.segments, 'segment start', 'segment starts') : null,
        o.pagesMatched ? `${plural(o.pagesMatched, 'page', 'pages')} matched` : null,
        o.pagesCreated ? `${plural(o.pagesCreated, 'page', 'pages')} added to the witness` : null,
        o.zones ? plural(o.zones, 'box', 'boxes') : null,
        o.unplaced ? `${plural(o.unplaced, 'word', 'words')} in Staging` : null,
      ]
        .filter(Boolean)
        .join(', '),
    warnings: 'Notes',
    notes: {
      unresolvedLabels: (n: number, shown: string, more: boolean) =>
        `${n === 1 ? '1 label' : `${n} labels`} not in the work's numbering: ${shown}${more ? ', …' : ''}`,
      unresolvedPlaces: (n: number) =>
        `${n === 1 ? '1 numbered place' : `${n} numbered places`} could not be read as labels of the work.`,
      teiPagesUnplaced: (n: number) =>
        n === 1
          ? '1 page of the file is not a page of the witness; its text is in Staging.'
          : `${n} pages of the file are not pages of the witness; their text is in Staging.`,
      layoutPagesUnplaced: (n: number) =>
        `${n === 1 ? '1 page' : `${n} pages`} of the file are not pages of the witness; their words have no zones.`,
      badSource: 'Give an http or https URL, or a CTS URN.',
      sourceStatus: (status: number, text: string) => `The URL answered ${status} ${text}.`,
      sourceTooLarge: 'The file at that URL is larger than 20 MB.',
      sourceUnreachable: 'The URL could not be reached.',
    },
    emptyText: 'There is nothing to import.',
    conflict: 'The text changed while you were importing; it has been reloaded. Try again.',
    failed: (message: string) => `The import failed: ${message}`,
    unreadable: 'the file could not be read as expected. Check that it is the format chosen.',
  },

  settings: {
    title: 'Settings',
    name: 'Name of Transcript',
    keepWritten: 'Keep a diplomatic form beside the normalized',
    keepWrittenHint:
      'The text as it stands becomes the normalized text; the diplomatic text starts as a copy of it.',
    dropWrittenWarning:
      'Turning this off keeps the normalized text only. The diplomatic text stays in the history.',
    asWritten: 'Show the diplomatic text without word division',
    sources: 'Sources',
    sourcesHint: 'Printed with the other sources.',
    rightsNote: 'Note on Rights',
    licenceFixed: (name: string) => `Published under ${name}, fixed when it was first published.`,
    licenceToCome: (name: string) =>
      `Publishing puts it under ${name}, the licence of this installation.`,
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Settings saved.',
    nameRequired: 'Give the transcript a name.',
  },

  errors: {
    notFound: 'No such transcript',
    forbidden: 'You may not change this transcript.',
    network: 'The server could not be reached.',
  },
};
