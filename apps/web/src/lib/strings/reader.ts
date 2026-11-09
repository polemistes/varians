/**
 * Every user-facing string of the reader (PLAN 5.8, 6.4): the public page
 * of an edition, its panels, its settings, its plain-text export. Imported
 * as `reader` from '$lib/strings/reader'. Plain English, no em dashes.
 */

export const reader = {
  /** The header and the title block. */
  editedBy: (editors: string) => `edited by ${editors}`,
  editedByPlain: (editors: string) => `Edited by ${editors}`,
  authorAndWork: (author: string | null, work: string) => (author ? `${author}, ${work}` : work),
  version: (n: number) => `Version ${n}`,
  published: 'published',
  draft: 'Draft',
  draftVersion: (version: number) => `Draft, version ${version}`,
  previewVersion: (version: number) => `Preview of the draft, version ${version}`,
  unnumbered: 'Published',

  notices: {
    draftTitle: 'Draft',
    draftText: 'This edition is not published. Only its editors can see it.',
    previewTitle: 'Preview of the draft',
    previewText: 'This is the current draft, as readers will see it once it is published.',
    previewReaders: (n: number) => `Readers now see version ${n}.`,
    showPublished: 'Show the published version',
    versionTitle: (n: number) => `Version ${n}, published`,
    versionText: 'You are reading the edition as it was published then.',
    versionIsCurrent: 'This is the current version.',
    readCurrent: 'Read the current version',
    segmentMissing: (label: string) => `This edition has no segment ${label}.`,
  },

  /** The toolbar. */
  toolbar: {
    settings: 'Reading settings',
    witnesses: 'Witnesses',
    facsimile: 'Facsimile',
    variants: 'Variants',
    dictionary: 'Dictionary',
    more: 'Downloads and versions',
    search: 'Search the text',
    searchPlaceholder: 'Search',
    searchNext: 'Next match',
    searchPrevious: 'Previous match',
    searchClear: 'Clear the search',
    searchCount: (current: number, total: number) => `${current} of ${total}`,
    searchNone: 'No match',
  },

  menu: {
    downloads: 'Download',
    plainText: 'Plain Text with Apparatus',
    tei: 'TEI XML',
    versions: 'Published Versions',
    noVersions: 'Not Published Yet',
    current: 'current',
    preview: 'Preview the Draft',
    published: 'Show the Published Version',
    editor: 'Open in the Editor',
    copy: 'Make a Copy…',
  },

  /** The gear. */
  settings: {
    title: 'Reading settings',
    textSize: 'Text size',
    sizes: { small: 'Small', normal: 'Normal', large: 'Large' },
    apparatus: 'Apparatus',
    apparatusNone: 'Not shown',
    apparatusFoot: 'Below the text, as in print',
    apparatusSide: 'Beside the text, as in print',
    apparatusNoneHint: 'Click a word with a dotted line to see its variants, or open the list of variants.',
    apparatusSideHint: 'Beside the text on wide screens.',
    form: 'Form',
    positive: 'Positive',
    negative: 'Negative',
    editionForm: (form: 'positive' | 'negative') =>
      form === 'positive'
        ? 'The edition names the witnesses that agree with its text.'
        : 'The edition names only the witnesses that differ from its text.',
    interpretative: 'Interpretative variants',
    interpretativeOptions: { apparatus: 'With the others', separate: 'In a list of their own', none: 'Not shown' },
    interpretativeHint: 'Accents, breathings, punctuation and word division: the same letters read otherwise.',
    editionInterpretative: (placement: 'apparatus' | 'separate' | 'none') =>
      placement === 'apparatus'
        ? 'The edition prints them with the others.'
        : placement === 'separate'
          ? 'The edition prints them in a list of their own.'
          : 'The edition does not print them.',
    labels: 'Line labels',
    labelsEdition: 'As in the edition',
    labelsEvery: 'Every line',
    underline: 'Mark words with variants',
    reset: 'Reset',
  },

  /** The text and its apparatus. */
  text: {
    label: 'The text',
    preface: 'Preface',
    worksCited: 'Works cited',
    apparatus: (label: string) => `Apparatus to ${label}`,
    interpretative: 'Interpretative variants',
    noteBy: (author: string) => `by ${author}`,
    lacuna: 'Lacuna',
    lacunaOf: (extent: string) => `Lacuna: ${extent}`,
    gap: 'Text lost',
    gapOf: (quantity: number, unit: string) => `Text lost: about ${quantity} ${unit}`,
    space: 'Blank space',
    note: 'Note',
    empty: 'This edition has no text yet.',
    permalink: (label: string) => `Link to ${label}`,
  },

  /** The popover of a word with variants. */
  entry: {
    title: (label: string) => `Variants at ${label}`,
    notes: 'Notes',
    showWitness: 'Witness text',
    showFacsimile: 'Facsimile',
    close: 'Close',
  },

  /**
   * Plain sentences about a variant place, for the popover and the list of
   * variants. `{who}` stands for one or more witnesses by name, `{name}` for
   * a scholar, `{words}` for words of the text, `{source}` for where a
   * reading is reported. `one` and `many` agree with the number of witnesses.
   */
  explain: {
    and: 'and',
    /** A witness the edition does not list, by its siglum. */
    unknownWitness: (siglum: string) => `Witness ${siglum}`,
    /** A witness collated as it stood before the scribe's corrections. */
    beforeCorrection: (name: string) => `${name} before correction`,
    /** A witness collated as it stood after a stage of correction. */
    afterStage: (name: string, stage: number) => `${name} after stage ${stage} of correction`,
    /** A witness collated with the corrections of one hand. */
    correctedBy: (name: string, hand: string) => `${name} with the corrections of ${hand}`,
    theScribe: 'the scribe',
    anotherHand: 'another hand',
    /** The variants a witness notes in its margins or between its lines, collated as a text of their own; `start` opens a sentence. */
    variantNoted: (name: string) => `a variant noted in ${name}`,
    variantNotedStart: (name: string) => `A variant noted in ${name}`,
    /** What the edition prints, and on what authority. */
    follows: 'The edition follows {who}.',
    followsEvery: 'The edition follows every witness.',
    reportedFrom: 'The reading of {who} is known from {source}.',
    reportedOnly: 'The reading of {who} is known only from a report.',
    conjecture: 'The edition prints a conjecture of {name}; no witness has it.',
    conjectureAlso: { one: 'The edition prints a conjecture of {name}, which {who} also has.', many: 'The edition prints a conjecture of {name}, which {who} also have.' },
    conjectureOwn: "The edition prints the editor's own conjecture; no witness has it.",
    conjectureDeletion: 'The edition leaves these words out, as {name} proposed; the witnesses have them.',
    conjectureLacuna: 'The edition marks words as missing here, as {name} proposed.',
    editorAdded: 'No witness has these words; the editor added them.',
    editorReading: "No witness has this reading; it is the editor's own.",
    editorLeftOut: 'The editor leaves out what the witnesses have here.',
    /** The witnesses' readings. */
    reads: { one: '{who} reads {words}.', many: '{who} read {words}.' },
    /** The same word in another form, by the analyser of Greek forms. */
    readsForm: { one: '{who} reads {words}, another form of the same word.', many: '{who} read {words}, another form of the same word.' },
    /** The same letters read otherwise: accents, breathings, punctuation, word division. */
    /** The words come last and stand alone, since their punctuation may be the difference. */
    readsInterpretative: { one: '{who} reads the same letters otherwise: {words}', many: '{who} read the same letters otherwise: {words}' },
    omits: { one: '{who} leaves these words out.', many: '{who} leave these words out.' },
    adds: { one: '{who} adds {words} here.', many: '{who} add {words} here.' },
    lost: { one: '{who} is damaged here; its text is lost.', many: '{who} are damaged here; their text is lost.' },
    damaged: { one: '{who} is damaged here and reads only {words}.', many: '{who} are damaged here and read only {words}.' },
    otherOrder: { one: '{who} has these words in another order: {words}.', many: '{who} have these words in another order: {words}.' },
    otherOrderPlain: { one: '{who} has these words in another order.', many: '{who} have these words in another order.' },
    otherPlace: { one: '{who} has these words in another place.', many: '{who} have these words in another place.' },
    absent: { one: '{who} does not have this passage.', many: '{who} do not have this passage.' },
    /** Spelling only. */
    /** Readings reported by others, and conjectures. */
    reportedReads: '{who} is reported to read {words}.',
    reportedReadsFrom: '{who} is reported to read {words}, according to {source}.',
    reportedOmits: '{who} is reported to leave these words out.',
    reportedOmitsFrom: '{who} is reported to leave these words out, according to {source}.',
    theEditor: 'The editor',
    proposed: '{name} proposed {words}.',
    proposedDeletion: '{name} proposed deleting these words.',
    proposedLacuna: '{name} thought words are missing here.',
    proposedAddition: '{name} proposed adding {words} here.',
    proposedOrder: '{name} proposed the order {words}.',
    proposedMove: '{name} proposed moving these words.',
    /** Where an addition stands, beside the edition's words. */
    after: 'after {words}',
    before: 'before {words}',
    /** Read after a witness's siglum by screen readers and copied with it. */
    siglumOpen: ' (',
    siglumClose: ')',
  },

  /** The panels. */
  panels: {
    region: 'Panels',
    resize: 'Resize the panels',
    close: (name: string) => `Close ${name.toLowerCase()}`,
    conspectus: 'Conspectus siglorum',
    conspectusEmpty: 'The edition names no witnesses.',
    absentFrom: 'absent from',
    reportedOnly: 'Enters through reported readings only.',
    witness: 'Witness',
    chooseWitness: 'Witness',
    readForm: 'Normalized',
    writtenForm: 'Diplomatic',
    formLabel: 'Form shown',
    noTranscription: 'This witness has no transcript; it enters the apparatus through reported readings only.',
    absent: 'not in this witness',
    failed: 'The witness text could not be loaded.',
    nothingOnScreen: 'Scroll to some text to see this witness beside it.',
    facsimile: 'Facsimile',
    facsimileLoading: 'Loading the image',
    noImage: 'There is no image of this passage.',
    noImageOfPage: (page: string) => `There is no image of page ${page}.`,
    facsimileFailed: 'The image could not be found.',
    facsimileHint: 'Open a word with variants to see it on the page.',
    variants: 'Variants',
    variantsNone: 'Nothing varies in the lines on screen.',
    variantsNothingOnScreen: 'Scroll to some text to see its variants.',
    variantsShow: (words: string, label: string) => `Show ${words} at ${label} in the text`,
    page: (label: string) => `Page ${label}`,
    viewer: { zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit the page', controls: 'Zoom' },
    dictionary: {
      title: 'Dictionary',
      placeholder: 'Look up a Greek word',
      prompt: 'Click a word in the text, or type one here.',
      loading: 'Looking it up',
      failed: 'The dictionary could not be reached.',
      noAnalysis: (word: string) => `No analysis of ${word} is known.`,
      noEntry: (lemma: string) => `No dictionary has an entry for ${lemma}.`,
      from: (title: string, licence: string) => `${title}. ${licence}.`,
    },
  },

  /** The colophon at the foot of the page. */
  colophon: {
    title: 'About this edition',
    sources: 'Sources',
    licence: 'Licence',
    rightsNote: 'Rights',
    cite: 'How to cite',
    citation: (editors: string, title: string, version: string, date: string, address: string, licence: string | null) =>
      `${editors ? `${editors}, ` : ''}${title}, ${version} (${date}), ${address}.${licence ? ` ${licence}.` : ''}`,
    usedByVarians: 'Sources and licences of the data Varians uses',
    copiedFrom: 'Based on',
    copiedVersion: (n: number) => `version ${n}`,
    copiedDraft: 'a draft',
    editedBy: (names: string) => `edited by ${names}`,
    downloads: 'Download',
    versions: 'Published versions',
    current: 'current',
  },

  /** The plain-text export. */
  plain: {
    note: 'Note',
    interpretative: 'Interpretative',
  },
} as const;
