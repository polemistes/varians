/**
 * The editor's user-facing strings. They live here until the shared strings
 * module (src/lib/strings) is in place; move them there then.
 */

export const markLabels: Record<string, string> = {
  unclear: 'unclear',
  supplied: 'supplied',
  del: 'deleted',
  add: 'added',
  abbr: 'abbreviation',
  hi: 'highlighted',
  sic: 'sic',
  damage: 'damaged',
  surplus: 'surplus',
  corr: 'corrected',
  orig: 'original',
  reg: 'regularized',
  subst: 'substitution',
  handShift: 'change of hand',
  crux: 'crux',
  note: 'note',
  gap: 'gap',
  space: 'space',
  variant: 'variant',
};

export const objectLabels: Record<string, string> = {
  gap: 'gap',
  figure: 'figure',
  mark: 'mark',
  note: 'note',
  lacuna: 'lacuna',
  paratext: 'paratext',
  space: 'vac.',
};

export const breakLabels: Record<string, string> = {
  line: 'line',
  column: 'column',
  page: 'page',
  paragraph: 'paragraph',
};

export const editorStrings = {
  /** Shown in a tooltip before the other form of a word. */
  readForm: 'normalized',
  writtenForm: 'diplomatic',
  unchecked: 'normalized form unchecked',
  joined: 'one word with the next line',
  unassigned: 'unassigned',
  /** Gutter label of a run that names no segment. */
  unassignedShort: '–',
  gapUnknown: '[...]',
  /** `{n}` is the quantity, `{unit}` the unit when it is not characters. */
  gapQuantity: '[ca. {n}{unit}]',
  gapLines: ' lines',
  segmentGutter: 'Segment labels',
  lineGutter: 'Line numbers',
  setSegment: 'Set the segment that begins at this line',
  /** What the rule says where a break would go, before it is made. */
  breakPreview: {
    column: 'A new column begins here',
    paragraph: 'A new paragraph begins here',
    any: 'A break goes before this line',
  } as Record<'column' | 'paragraph' | 'any', string>,
  /** The heading of the text on no page in the whole text. */
  notOnAPage: 'Not on a page',
  /** The title of a gutter label a page's first line inherits from the page before. */
  runningSegment: 'The segment continues from before; click to set the segment of this word',
  editor: 'Transcription Text',
  /** A variant noted in the carrier, by where it stands. */
  variantPlaces: {
    margin: 'in the margin',
    interlinear: 'between the lines',
    other: 'elsewhere',
  } as Record<string, string>,
  /** What a variant that leaves the words out reads. */
  variantOmits: 'leaves these words out',
  variantHand: (hand: string) => `hand ${hand}`,
  /** The hand and stage of a deletion or an addition, in its tooltip. */
  correctionHand: (hand: string) => `hand ${hand}`,
  correctionStage: (n: number) => `stage ${n}`,
  /** The title of words a variant covers: `{reading}` its words, `{place}` where it stands. */
  variantTitle: (reading: string, place: string) =>
    reading === '' ? `Variant ${place}: leaves these words out` : `Variant ${place}: ${reading}`,
};

export const toolbarStrings = {
  marks: 'Marks',
  objects: 'Objects',
  breaks: 'Breaks',
  structure: 'Structure',
  removeMark: 'Remove Mark',
  removeMarkTitle: 'Remove the chosen mark from the selection',
  gap: 'Gap',
  space: 'Space',
  figure: 'Figure',
  note: 'Note',
  columnBreak: 'Column Break',
  paragraph: 'Paragraph',
  join: 'Join with Next Line',
  joinTitle: 'The word at the end of this line continues on the next',
  segment: 'Segment Here',
  segmentTitle: 'Begin a segment at the word under the caret',
  shortcuts: {
    unclear: 'Mod-Shift-U',
    supplied: 'Mod-Shift-S',
    del: 'Mod-Shift-D',
    add: 'Mod-Shift-A',
    abbr: 'Mod-Shift-B',
    gap: 'Mod-Shift-G',
    segment: 'Mod-Shift-L',
  } as Record<string, string>,
};

/** Short labels for the toolbar's mark buttons. */
export const markButtonLabels: Record<string, string> = {
  unclear: 'Unclear',
  supplied: 'Supplied',
  del: 'Deleted',
  add: 'Added',
  abbr: 'Abbr.',
  hi: 'Highlight',
  sic: 'Sic',
  damage: 'Damage',
  surplus: 'Surplus',
};
