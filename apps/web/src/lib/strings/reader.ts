/**
 * Every user-facing string of the reader: the public page
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
  /** The draft of an edition that has a version, as its editors preview it. */
  preview: 'Preview of the draft',

  notices: {
    draftTitle: 'Draft',
    draftText: 'The edition has no version yet. Only its editors see the draft.',
    previewTitle: 'Preview of the Draft',
    previewText: 'This is the draft, which only the editors see.',
    previewReaders: (n: number) => `Readers see version ${n}.`,
    showPublished: 'Show the published version',
    versionText: 'You are reading the edition as this version was published.',
    versionIsCurrent: 'This is the latest version.',
    readCurrent: 'Read the latest version',
    segmentMissing: (label: string) => `This edition has no segment ${label}.`,
  },

  /** The toolbar. */
  toolbar: {
    settings: 'Reading Settings',
    witnesses: 'Witnesses',
    facsimile: 'Facsimile',
    variants: 'Variants',
    dictionary: 'Dictionary',
    search: 'Search the text',
    searchPlaceholder: 'Search',
    searchNext: 'Next Match',
    searchPrevious: 'Previous Match',
    searchClear: 'Clear the Search',
    searchCount: (current: number, total: number) => `${current} of ${total}`,
    searchNone: 'No match',
  },

  menu: {
    preview: 'Preview the Draft',
    published: 'Show the Published Version',
  },

  /** The gear. */
  settings: {
    title: 'Reading Settings',
    textSize: 'Text Size',
    sizes: { small: 'Small', normal: 'Normal', large: 'Large' },
    interpretative: 'Interpretative Variants',
    interpretativeShown: 'Shown',
    interpretativeHidden: 'Not Shown',
    interpretativeHint:
      'Accents, breathings, punctuation and word division: the same letters read otherwise.',
    minor: 'Minor Variants',
    minorShown: 'Shown',
    minorHidden: 'Not Shown',
    labels: 'Segment Labels',
    labelsEdition: 'As in the edition',
    labelsEvery: 'Every segment',
    underline: 'Mark words with variants',
    reset: 'Reset',
  },

  /** The text and its apparatus. */
  text: {
    label: 'The text',
    preface: 'Preface',
    worksCited: 'Works Cited',
    apparatus: (label: string) => `Apparatus to ${label}`,
    interpretative: 'Interpretative variants',
    noteBy: (author: string) => `by ${author}`,
    lacuna: 'Lacuna',
    lacunaOf: (extent: string) => `Lacuna: ${extent}`,
    notTranscribed: 'Not transcribed',
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
    showWitness: 'Witness Text',
    showFacsimile: 'Facsimile',
    close: 'Close',
  },

  /**
   * The variant window: a list of the witnesses that are there and one row
   * for each reading. Words are never said of what a reading means or how it
   * is formed.
   */
  variant: {
    /** The witnesses of the conspectus that are there, when all are and when some are. */
    thereAll: (total: number) =>
      total === 1
        ? 'In the only witness'
        : total === 2
          ? 'In both witnesses'
          : `In all ${total} witnesses`,
    thereSome: (count: number, total: number) => `In ${count} of ${total} witnesses`,
    /** Before the witnesses in which the words are an addition. */
    addition: 'Addition in',
    /** The kinds of variant a head names. */
    minor: 'Minor',
    interpretative: 'Interpretative',
    /** Where a variant stands that has no words of the edition. */
    after: 'after',
    before: 'before',
    /** Where a block of segments opens the text, in the row that says which segment it follows. */
    first: 'first',
    /** Read before the row of the edition's reading, which is set apart by its weight alone. */
    edition: 'Edition',
    /** What stands in place of a reading's words where a witness has none, or where a conjecture proposes none. */
    notIn: 'not in',
    delete: 'delete',
    lacuna: 'lacuna',
    add: 'add',
    move: 'move',
    /** What a reading rests on besides witnesses. */
    conjecture: 'conjecture',
    theEditor: 'the editor',
    /** Where the edition has no words and every witness that is there has some: the row reads "not in the edition". */
    theEdition: 'the edition',
    /** A witness known only from a report, with where the report is. */
    reported: (source: string) => (source ? `reported, ${source}` : 'reported'),
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
    /** The variants a witness notes in its margins or between its lines, collated as a text of its own. */
    variantNoted: (name: string) => `Variant noted in ${name}`,
    /** From a row to the variant where the same witnesses have the words in another place. */
    open: (where: string) => `Open the Variant ${where}`,
    /** The point between two words, for the mark in the text. */
    pointAfter: (word: string) => `Variant after ${word}`,
    pointBefore: (word: string) => `Variant before ${word}`,
    /** The mark of a variant over whole segments (in verse in the margin, in prose on their labels), by their labels. A segment the edition does not print has the point's name: "Variant after 1.2". */
    segmentAt: (labels: string) => `Variant at ${labels}`,
  },

  /** The panels. */
  panels: {
    region: 'Panels',
    resize: 'Resize the Panels',
    close: (name: string) => `Close ${name}`,
    conspectus: 'Conspectus Siglorum',
    conspectusEmpty: 'The edition names no witnesses.',
    groups: 'Groups',
    absentFrom: 'no text for',
    reportedOnly: 'Enters through reported readings only.',
    witness: 'Witness',
    chooseWitness: 'Witness',
    readForm: 'Normalized',
    writtenForm: 'Diplomatic',
    formLabel: 'Form Shown',
    noTranscription:
      'This witness has no transcript; it enters the apparatus through reported readings only.',
    absent: 'not in this witness',
    failed: 'The witness text could not be loaded.',
    nothingOnScreen: 'Scroll to some text to see this witness beside it.',
    facsimile: 'Facsimile',
    facsimileLoading: 'Loading the image',
    noImage: 'There is no image of this passage.',
    noImageOfPage: (page: string) => `There is no image of page ${page}.`,
    /** The words stand on no page of the witness in its transcript. */
    unplaced: 'These words are not on a page of the witness.',
    facsimileFailed: 'The image could not be found.',
    facsimileHint: 'Open a word with variants to see it on the page.',
    variants: 'Variants',
    variantsNone: 'Nothing varies in the segments on screen.',
    variantsNothingOnScreen: 'Scroll to some text to see its variants.',
    variantsShow: (words: string, label: string) => `Show ${words} at ${label} in the Text`,
    page: (label: string) => `Page ${label}`,
    viewer: { zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fit: 'Fit the Page', controls: 'Zoom' },
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
    title: 'About This Edition',
    /** The languages the text contains, most words first. */
    languages: 'Languages',
    sources: 'Sources',
    licence: 'Licence',
    rightsNote: 'Rights',
    cite: 'How to cite',
    citation: (
      editors: string,
      title: string,
      version: string,
      date: string,
      address: string,
      licence: string | null,
    ) =>
      `${editors ? `${editors}, ` : ''}${title}, ${version} (${date}), ${address}.${licence ? ` ${licence}.` : ''}`,
    usedByVarians: 'Sources and licences of the data Varians uses',
    copiedFrom: 'Based on',
    copiedVersion: (n: number) => `version ${n}`,
    copiedDraft: 'a draft',
    editedBy: (names: string) => `edited by ${names}`,
    downloads: 'Download',
    versions: 'Versions',
  },

  /** The plain-text export. */
  plain: {
    note: 'Note',
    interpretative: 'Interpretative',
  },
} as const;
