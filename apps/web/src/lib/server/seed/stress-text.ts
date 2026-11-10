/**
 * The text of the stress edition: a verse work of some thousand lines in
 * many witnesses, made up, deterministic from a seed, and plain data. It is
 * not realistic. It holds every kind of element a real edition has, in
 * quantities that show how Varians copes: three families of manuscripts
 * descended from lost ancestors with errors of their own, contamination,
 * partial and damaged coverage, corrections by several hands, marginal
 * variants, scholia, abbreviations, papyri broken in every line, and a
 * witness known only from reported readings. Nothing here touches the
 * database; stress.ts writes it through the application's services.
 */

import { stripDiacritics } from '@varians/core';

// A small deterministic generator

export interface Random {
  /** A number in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** An integer in [low, high]. */
  range(low: number, high: number): number;
  chance(p: number): boolean;
  pick<T>(list: readonly T[]): T;
  shuffle<T>(list: readonly T[]): T[];
  /** An independent generator for a part of the work, so that changing one part does not disturb the others. */
  fork(label: string): Random;
}

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32, seeded. */
export function makeRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const random: Random = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (low, high) => low + Math.floor(next() * (high - low + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)]!,
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    fork: (label) => makeRandom(hashOf(`${seed}:${label}`)),
  };
  return random;
}

// The words

/** The koronis the base text elides with, as the sample text writes it. */
export const KORONIS = '\u1fbd';
/** The high dot (ano teleia). */
export const HIGH_DOT = '\u00b7';

const ELIDED_STEMS = [
  'δ',
  'τ',
  'γ',
  'ἀλλ',
  'ἐπ',
  'ἀπ',
  'ἄρ',
  'μ',
  'σ',
  'οὔτ',
  'οὐδ',
  'ὅτ',
  'ἔτ',
  'ἐφ',
];

const WORDS = `
ὁ ἡ τὸ τοῦ τῆς τῷ τὴν τὸν τὰ τῶν καὶ δὲ γὰρ μὲν οὖν τε δὴ οὐ μὴ ἐν ἐκ πρὸς ἀπὸ κατὰ μετὰ περὶ εἰς ὡς ὅτι
θεὸς θεοῖς θεῶν βροτοῖς βροτῶν πόλις πόλεως γῆς γαῖαν χθονὸς δόμοις δόμων φρενῶν φρένα ψυχὴν ψυχῆς
καρδίαν χεῖρα χερὸς κάρα ὄμμα πατρὸς μητρὸς τέκνα τέκνων παῖδα παιδὸς ἄνδρα ἀνδρὸς γυνὴ γυναικὸς
λόγον λόγων ἔπος νόμον νόμοις βίον βίου θάνατον θανάτου φόνον φόνου αἷμα
ἔχει ἔχω ἔχων λέγω λέγει εἶπε εἶπον ἔθηκε θεῖναι ἔδωκε ἐλθεῖν ἦλθε φέρει φέρω ἔφυ πέφυκε ἔστι ἐστὶν
εἰσὶ ἦν ἔσται γένοιτο ὄλοιτο κτανεῖν θανεῖν ὀλέσαι σῶσαι ἔπραξε δράσεις ὁρῶ ὁρᾷς ἔμαθον μάθοις ἔλιπε λιπεῖν
κακὸν κακοῖς ἀγαθὸν μέγας μεγάλης πολλὰ πολλῶν πάντα πᾶσι πάντων ἄλλος ἄλλην δεινὸν δεινὰ φίλος
φίλων ἐχθρῶν ἐχθροῖς καλὸν αἰσχρὸν δίκαιον σοφὸς νῦν τότε ἀεὶ ἔτι οὐδὲν οὐδεὶς πάλιν ἐνθάδε ἐκεῖ
ἐγὼ σὺ ἡμῖν ὑμῖν αὐτὸς αὐτοῦ ἐμοῦ σοῦ τοῦτο ταῦτα τοῖσδε τάδε
`
  .split(/\s+/u)
  .filter((w) => w !== '');

/** Some 150 accented words, with elided forms, to make verse of. */
export const VOCABULARY: readonly string[] = [
  ...WORDS,
  ...ELIDED_STEMS.map((stem) => `${stem}${KORONIS}`),
].map((w) => w.normalize('NFC'));

// Names for the editors, the conjectures and the speakers: all made up.

const PROPOSERS = [
  'Aldous Fenwick',
  'Marguerite Dalloway',
  'Tobias Quillon',
  'Imogen Harcastle',
  'Lucan Verrill',
  'Philippa Stannard',
  'Cornelius Ashby',
  'Odile Merrow',
  'Barnaby Tessel',
  'Hester Wrenfield',
  'Silas Pembrook',
  'Eugenia Larkin',
  'Matthias Orcutt',
  'Winifred Garrow',
  'Ambrose Kettle',
  'Delphine Rooke',
  'Hugo Penhallow',
  'Rosalind Veitch',
  'Leopold Maddox',
  'Constance Ire',
  'Quentin Abney',
  'Theodora Lisle',
  'Ignatius Vale',
  'Beatrix Calloway',
];

const SPEAKERS = [
  'ΧΟΡΟΣ',
  'ΑΓΓΕΛΟΣ',
  'ΒΑΣΙΛΕΥΣ',
  'ΘΕΡΑΠΩΝ',
  'ΚΗΡΥΞ',
  'ΒΑΣΙΛΙΣΣΑ',
  'ΠΑΙΣ',
  'ΣΤΡΑΤΗΓΟΣ',
  'ΤΡΟΦΟΣ',
  'ΠΡΕΣΒΥΣ',
];

const HEADINGS = [
  'Πρόλογος',
  'Πάροδος',
  'Ἐπεισόδιον',
  'Στάσιμον',
  'Κομμός',
  'Ἔξοδος',
  'Ῥῆσις',
  'Ἀγών',
];

const SURNAMES = [
  'Ashdown',
  'Brannock',
  'Carrow',
  'Dunmore',
  'Eskdale',
  'Farrant',
  'Gillow',
  'Hartnoll',
  'Ibbotson',
  'Jessop',
  'Kinloch',
  'Lanyon',
  'Merriot',
  'Netherby',
  'Ormerod',
  'Prestwick',
  'Quarrell',
  'Radnor',
  'Salter',
  'Thackray',
  'Ullathorne',
  'Venning',
  'Whitcombe',
  'Yarrow',
];

// Rates of difference: the chance, per line and per stage of copying, of each kind of difference.

/**
 * The kinds of difference between a manuscript and what it was copied from,
 * each a chance per line. A family's lost ancestor differs from the text by
 * these at `ANCESTOR_STAGE` times the rate, each manuscript from its
 * ancestor at `OWN_STAGE` times: together about a line in four of a given
 * manuscript differs from the text somewhere.
 */
export const RATES = {
  /** Another word in place of one. */
  substitution: 0.04,
  /** An accent, a breathing or a mark of punctuation only: the same letters. */
  accent: 0.02,
  /** Two words written as one. */
  merge: 0.006,
  /** One word written as two. */
  split: 0.006,
  /** A word left out. */
  omission: 0.014,
  /** A word added. */
  addition: 0.012,
  /** Two words in the other order. */
  transposition: 0.008,
  /** The last three words or more of a line left out. */
  truncation: 0.004,
  /** A whole line left out. */
  lineOmission: 0.004,
  /** Two neighbouring lines in the other order. */
  lineSwap: 0.002,
} as const;

export const ANCESTOR_STAGE = 1.3;
export const OWN_STAGE = 1;

/** Overlaps: places where one manuscript varies over three or four words and two others differ in one word each, per hundred lines. */
export const OVERLAPS_PER_HUNDRED = 1.1;

export const SPRINKLES = {
  /** Words with unclear letters, in a manuscript and in a papyrus. */
  unclear: 0.012,
  unclearPapyrus: 0.06,
  /** Lines with a note in the margin, a paragraphos, a space, a change of hand. */
  note: 0.012,
  paragraphos: 0.025,
  space: 0.01,
  handShift: 0.004,
  /** Words abbreviated, in the two manuscripts that abbreviate. */
  abbreviation: 0.01,
  /** Lines with a correction, in the two manuscripts corrected. */
  correction: 0.03,
  /** Lines with a variant noted in the margin, in the one that has them. */
  variant: 0.02,
  /** Lines with a gap at the start, at the end, a word broken by a gap, an illegible word, in a papyrus. */
  papyrusStart: 0.5,
  papyrusEnd: 0.5,
  papyrusBroken: 0.4,
  papyrusIllegible: 0.1,
} as const;

/** Lines to a page. */
export const PAGE_LINES = 25;

// What is made

export type Attrs = Record<string, string | number | boolean | null>;

export interface StressMark {
  kind: string;
  attrs?: Attrs;
  from?: number;
  to?: number;
}

/** One thing in a line: a word, an object that is a gap, or another object. */
export type StressItem =
  | { kind: 'word'; form: string; norm?: string; marks?: StressMark[] }
  | { kind: 'gap'; attrs: Attrs }
  | { kind: 'object'; type: 'mark' | 'note' | 'space'; attrs?: Attrs; text?: string };

/** A line of the work, or a scholium, with everything standing in it. */
export interface StressLine {
  kind: 'line';
  work: 'main' | 'scholia';
  /** The number the segment is labelled with, in its work. */
  number: number;
  items: StressItem[];
}

/** Lines lost between two stretches of a witness: a gap counted in lines. */
export interface StressLost {
  kind: 'lost';
  lines: number;
}

export type StressEntry = StressLine | StressLost;

export interface StressHand {
  id: string;
  label: string;
  description: string | null;
  main: boolean;
}

export type StressState =
  | { kind: 'original'; siglum: string }
  | { kind: 'stage'; stage: number; siglum: string }
  | { kind: 'hand'; hand: string; siglum: string };

export interface StressWitness {
  key: string;
  siglum: string;
  name: string;
  type: 'manuscript' | 'papyrus' | 'reported';
  /** The family a manuscript descends from, 0 to 2. */
  family: number | null;
  hands: StressHand[];
  /** Whether what is written is kept beside what is read. */
  keepsWrittenForm: boolean;
  diplomatic: 'none' | 'capitals' | 'itacistic';
  /** Labels of the pages, in order. */
  pages: string[];
  /** The text in the order of the witness: lines, scholia, lines lost. Empty for a witness only reported. */
  entries: StressEntry[];
  /** For each entry, the index of its page, or null when it is on no page. */
  pageOf: (number | null)[];
  /** Further states collated under sigla of their own. */
  states: StressState[];
  /** The siglum of the variants noted in the margin, if it has any. */
  variantSiglum: string | null;
  /** Roles that make the witness unlike the others, for the reader of a report and for tests. */
  roles: string[];
}

export interface StressScholium {
  number: number;
  /** The line it stands after. */
  after: number;
  words: string[];
}

export interface StressReported {
  witness: string;
  line: number;
  lemma: string;
  reading: string;
  source: string;
}

export type StressConjectureKind =
  | 'substitution'
  | 'deletion'
  | 'addition'
  | 'lacuna'
  | 'supplement'
  | 'transposition';

export interface StressConjecture {
  index: number;
  line: number;
  kind: StressConjectureKind;
  lemma: string;
  reading: string;
  proposer: string;
  note: string | null;
  /** Lines in the order proposed, for a transposition. */
  sequence: number[] | null;
  /** The index of the lacuna a supplement fills. */
  supplements: number | null;
  /** The lemma's position among the line's words, when the same words stand twice or more. */
  anchorWord: number | null;
  /** Indexes of the bibliography it cites. */
  cites: number[];
  /** The editors adopt it. */
  adopt: boolean;
}

export interface StressBibliography {
  index: number;
  key: string;
  entryType: 'book' | 'article' | 'incollection';
  fields: Record<string, string>;
  label: string;
}

/** What the editors do that does not depend on where the witnesses differ. */
export interface StressEditorPlan {
  speakers: { line: number; text: string }[];
  headings: { line: number; text: string }[];
  /** Words the editor marks as corrupt. */
  cruces: { line: number; word: number }[];
  /** Words the editor types over. */
  emendations: { line: number; word: number; reading: string; register: boolean }[];
  notes: { line: number; word: number | null; text: string; cites: number[] }[];
}

export interface StressText {
  lines: number;
  seed: number;
  /** The base text: the words of each line, line 1 first. */
  base: string[][];
  witnesses: StressWitness[];
  scholia: StressScholium[];
  reported: StressReported[];
  conjectures: StressConjecture[];
  bibliography: StressBibliography[];
  editors: StressEditorPlan;
  /** The key of the witness the edition is based on: complete, plain and undamaged. */
  baseWitness: string;
  /** The words of the base witness by line, which are what the edition begins with. */
  baseWitnessWords: string[][];
}

export interface StressOptions {
  /** Lines of verse in the work; 1300 is about a play. */
  lines?: number;
  /** Witnesses in all: manuscripts, papyri and the one that is only reported. */
  witnesses?: number;
  seed?: number;
  /** Multiplies every rate of difference; 0 makes every manuscript read as the text. For tests. */
  rateScale?: number;
}

export const DEFAULT_LINES = 1300;
export const DEFAULT_WITNESSES = 30;

// Words and their disguises

const ACUTE = '\u0301';
const PERISPOMENI = '\u0342';
const SMOOTH = '\u0313';
const ROUGH = '\u0314';

const MARKS_AFTER = /^(.*?)([,.\u00b7\u0387]*)$/su;

/** A word and the punctuation attached to its end. */
export function splitPunctuation(word: string): { bare: string; punctuation: string } {
  const m = MARKS_AFTER.exec(word)!;
  return { bare: m[1]!, punctuation: m[2]! };
}

function letters(word: string): string {
  return splitPunctuation(word).bare;
}

/** Another accent or breathing on the same letters; where there is none to change, the punctuation. */
export function accentVariant(word: string, rng: Random): string {
  const { bare, punctuation } = splitPunctuation(word);
  const nfd = bare.normalize('NFD');
  const options: string[] = [];
  if (nfd.includes(PERISPOMENI)) options.push(nfd.replace(PERISPOMENI, ACUTE));
  else if (nfd.includes(ACUTE)) options.push(nfd.replace(ACUTE, PERISPOMENI));
  if (/[\u0301\u0300\u0342]/u.test(nfd)) options.push(nfd.replace(/[\u0301\u0300\u0342]/u, ''));
  if (nfd.includes(SMOOTH)) options.push(nfd.replace(SMOOTH, ROUGH));
  else if (nfd.includes(ROUGH)) options.push(nfd.replace(ROUGH, SMOOTH));
  const candidates = options
    .map((o) => o.normalize('NFC') + punctuation)
    .filter((o) => o.normalize('NFC') !== word);
  if (candidates.length > 0 && !rng.chance(0.15)) return rng.pick(candidates);
  // Punctuation instead: put one on, or take it off.
  if (punctuation !== '') return bare;
  return bare + rng.pick([',', HIGH_DOT, '.']);
}

const VOWEL_SWAP: Record<string, string> = {
  α: 'ε',
  ε: 'α',
  ο: 'ε',
  η: 'ε',
  ω: 'ο',
  ι: 'ε',
  υ: 'ι',
};

/** A word near it, as a scribe might have written: an ending changed, a nu added or lost. Never the same word. */
export function nearWord(word: string, rng: Random): string {
  const { bare, punctuation } = splitPunctuation(word);
  const text = bare.normalize('NFC');
  const nfd = Array.from(bare.normalize('NFD'));
  const tries: string[] = [];
  if (text.endsWith('ν')) tries.push(text.slice(0, -1));
  else if (/[αεηιουω]$/u.test(stripDiacritics(text))) tries.push(`${text}ν`);
  // The last vowel, with the marks that follow it, becomes another.
  for (let i = nfd.length - 1; i >= 0; i--) {
    const swap = VOWEL_SWAP[nfd[i]!];
    if (!swap) continue;
    const next = [...nfd];
    next[i] = swap;
    tries.push(next.join('').normalize('NFC'));
    break;
  }
  const candidates = tries.filter((t) => t !== text && t !== '').map((t) => t + punctuation);
  return candidates.length > 0 ? rng.pick(candidates) : '';
}

/** Another word of the vocabulary, not one of `avoid`, keeping the punctuation of `like`. */
export function otherWord(like: string, avoid: readonly string[], rng: Random): string {
  const { punctuation } = splitPunctuation(like);
  const bareAvoid = new Set(avoid.map(letters));
  for (let i = 0; i < 20; i++) {
    const w = rng.pick(VOCABULARY);
    if (!bareAvoid.has(w)) return w + punctuation;
  }
  return rng.pick(VOCABULARY);
}

/** A reading in place of `word` that is not it. */
function substituteFor(word: string, line: readonly string[], rng: Random): string {
  if (rng.chance(0.5)) {
    const near = nearWord(word, rng);
    if (near !== '' && near !== word) return near;
  }
  return otherWord(word, line, rng);
}

/** The line as the text has it, or as a family's lost ancestor or a manuscript has it after the differences a stage adds. */
export function perturbLine(words: readonly string[], scale: number, rng: Random): string[] {
  const out = [...words];
  const at = (n = out.length) => rng.int(Math.max(1, n));
  if (rng.chance(RATES.substitution * scale) && out.length > 0) {
    const i = at();
    out[i] = substituteFor(out[i]!, out, rng);
  }
  if (rng.chance(RATES.accent * scale) && out.length > 0) {
    const i = at();
    out[i] = accentVariant(out[i]!, rng);
  }
  if (rng.chance(RATES.merge * scale) && out.length > 2) {
    const i = at(out.length - 1);
    const first = splitPunctuation(out[i]!).bare.replace(new RegExp(`${KORONIS}$`, 'u'), '');
    out.splice(i, 2, first + out[i + 1]!);
  }
  if (rng.chance(RATES.split * scale)) {
    const candidates = out
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => Array.from(letters(w)).length >= 5);
    if (candidates.length > 0) {
      const { w, i } = rng.pick(candidates);
      const { bare, punctuation } = splitPunctuation(w);
      const chars = Array.from(bare.normalize('NFC'));
      const cut = rng.range(2, chars.length - 2);
      if (!/\p{M}/u.test(chars[cut] ?? '')) {
        out.splice(i, 1, chars.slice(0, cut).join(''), chars.slice(cut).join('') + punctuation);
      }
    }
  }
  if (rng.chance(RATES.omission * scale) && out.length > 4) out.splice(at(), 1);
  if (rng.chance(RATES.addition * scale)) {
    const i = rng.int(out.length + 1);
    out.splice(i, 0, otherWord('', out, rng));
  }
  if (rng.chance(RATES.transposition * scale) && out.length > 2) {
    const i = at(out.length - 1);
    [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
  }
  if (rng.chance(RATES.truncation * scale) && out.length > 5) {
    const keep = rng.range(2, out.length - 3);
    out.length = keep;
  }
  return out;
}

// Diplomatic forms

/** Capitals without accents, breathings or punctuation: how an uncial hand writes. */
export function capitals(word: string): string {
  return stripDiacritics(word)
    .toUpperCase()
    .replace(/[,.;\u0387\u00b7\u1fbd]/gu, '');
}

const ITACISMS: [RegExp, string][] = [
  // On decomposed text: a base letter followed by its marks.
  [/ι/u, 'ει'],
  [/ε(?![\u0300-\u0345])(?=ι)/u, ''],
  [/η(?!\u0345)/u, 'ι'],
  [/α(?![\u0300-\u0345])(?=ι)ι/u, 'ε'],
  [/ε/u, 'αι'],
  [/ο/u, 'ω'],
  [/ω(?!\u0345)/u, 'ο'],
];

/** The word as a hand that confuses vowels writes it, in lower case, accents kept; the same word where no spelling applies. */
export function itacism(word: string, rng: Random): string {
  const nfd = word.normalize('NFD');
  const applicable = ITACISMS.filter(([pattern]) => pattern.test(nfd));
  if (applicable.length === 0) return word;
  const [pattern, replacement] = rng.pick(applicable);
  return nfd.replace(pattern, replacement).normalize('NFC');
}

/** A word as a witness writes it: `form` is what is written, `norm` what is read (absent where they are the same). */
export function writtenWord(
  read: string,
  style: 'none' | 'capitals' | 'itacistic',
  rng: Random,
): { form: string; norm?: string } {
  if (style === 'none') return { form: read };
  const form = style === 'capitals' ? capitals(read) : rng.chance(0.4) ? itacism(read, rng) : read;
  return form === read ? { form } : { form, norm: read };
}

// The stemma

interface Ancestor {
  /** Words of each line, by line number; null where the line is left out. */
  lines: (string[] | null)[];
  /** Lines that stand after the line that follows them. */
  swapped: boolean[];
}

function makeAncestor(base: string[][], scale: number, rng: Random): Ancestor {
  const lines: (string[] | null)[] = [];
  const swapped: boolean[] = [];
  for (let n = 0; n < base.length; n++) {
    if (rng.chance(RATES.lineOmission * scale * ANCESTOR_STAGE)) lines.push(null);
    else lines.push(perturbLine(base[n]!, scale * ANCESTOR_STAGE, rng));
    swapped.push(rng.chance(RATES.lineSwap * scale * ANCESTOR_STAGE));
  }
  return { lines, swapped };
}

interface Role {
  partial?: [number, number];
  loss?: [number, number];
  diplomatic: 'none' | 'capitals' | 'itacistic';
  corrected?: 1 | 2;
  variants?: boolean;
  scholia?: boolean;
  abbreviations?: boolean;
  unplaced?: number;
  noPages?: boolean;
  contaminated?: { from: number; to: number; family: number };
}

/** How many witnesses of each kind, for a total. One of each kind as long as the total allows. */
export function composition(witnesses: number): {
  manuscripts: number;
  papyri: number;
  reported: number;
} {
  const total = Math.max(1, Math.floor(witnesses));
  const reported = total >= 3 ? 1 : 0;
  const papyri = total >= 6 ? Math.max(1, Math.round((total * 4) / 30)) : total >= 4 ? 1 : 0;
  return { manuscripts: total - reported - papyri, papyri, reported };
}

function siglumOf(i: number): string {
  // A to Y, then A2 to Y2, and so on.
  const letter = String.fromCharCode(65 + (i % 25));
  return i < 25 ? letter : `${letter}${Math.floor(i / 25) + 1}`;
}

function hand(id: string, label: string, main: boolean): StressHand {
  return { id, label, description: main ? 'The scribe of the text.' : null, main };
}

const roman = (n: number) =>
  ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'][n] ?? String(n + 1);

/** Page labels of a codex: 1r, 1v, 2r, 2v... */
function codexLabel(i: number): string {
  return `${Math.floor(i / 2) + 1}${i % 2 === 0 ? 'r' : 'v'}`;
}

/** The text as made: base, witnesses, conjectures, bibliography and the editors' plan. */
export function generateStress(options: StressOptions = {}): StressText {
  const lines = Math.max(10, Math.floor(options.lines ?? DEFAULT_LINES));
  const seed = options.seed ?? 1;
  const scale = options.rateScale ?? 1;
  const root = makeRandom(seed);
  const { manuscripts, papyri, reported } = composition(options.witnesses ?? DEFAULT_WITNESSES);

  // The base text.
  const textRng = root.fork('text');
  const base: string[][] = [];
  for (let n = 0; n < lines; n++) {
    const count = textRng.range(5, 9);
    const words: string[] = [];
    while (words.length < count) {
      const w = textRng.pick(VOCABULARY);
      if (!words.includes(w)) words.push(w);
    }
    // Some words carry a comma, a high dot or a full stop; the end of a line more often.
    for (let i = 0; i < words.length; i++) {
      const last = i === words.length - 1;
      if (textRng.chance(last ? 0.4 : 0.09))
        words[i] += textRng.pick(last ? [',', '.', HIGH_DOT, ','] : [',', ',', HIGH_DOT, '.']);
    }
    base.push(words);
  }

  const scholiaRng = root.fork('scholia');
  const scholia: StressScholium[] = [];
  for (let after = scholiaRng.range(3, 8), number = 1; after <= lines; number++) {
    const words: string[] = [];
    for (let k = scholiaRng.range(7, 22); k > 0; k--) words.push(scholiaRng.pick(VOCABULARY));
    scholia.push({ number, after, words });
    after += scholiaRng.range(6, 12);
  }

  // Families, and what each manuscript is.
  const families = Math.min(3, Math.max(1, Math.ceil(manuscripts / 2)));
  const ancestors: Ancestor[] = Array.from({ length: families }, (_, f) =>
    makeAncestor(base, scale, root.fork(`ancestor${f}`)),
  );
  const roleRng = root.fork('roles');
  const roles: Role[] = Array.from({ length: manuscripts }, (_, i) => ({
    diplomatic: i % 2 === 1 ? (i % 4 === 1 ? 'capitals' : 'itacistic') : 'none',
  }));
  // Roles go to the manuscripts after the first, in an order shuffled by the seed, each kind to
  // manuscripts that do not have a role it would not go with, as long as there are enough.
  const pool = roleRng.shuffle(
    Array.from({ length: Math.max(0, manuscripts - 1) }, (_, i) => i + 1),
  );
  let cursor = 0;
  const assign = (count: number, ok: (r: Role) => boolean, give: (r: Role, i: number) => void) => {
    const given = new Set<number>();
    for (let tries = 0; tries < pool.length && given.size < count; tries++) {
      const i = pool[cursor++ % pool.length]!;
      if (!given.has(i) && ok(roles[i]!)) {
        given.add(i);
        give(roles[i]!, i);
      }
    }
  };
  const stretch = (min: number, max: number): [number, number] => {
    const length = Math.min(
      lines,
      Math.max(5, Math.round((lines * roleRng.range(min, max)) / 100)),
    );
    const from = roleRng.range(1, lines - length + 1);
    return [from, from + length - 1];
  };
  const clean = (r: Role) => !r.partial && !r.loss && !r.corrected && !r.variants;
  if (manuscripts >= 3) {
    assign(
      manuscripts >= 5 ? 2 : 1,
      clean,
      (r) => (r.corrected = roles.some((x) => x.corrected === 1) ? 2 : 1),
    );
    assign(manuscripts >= 4 ? 1 : 0, clean, (r) => (r.variants = true));
    assign(Math.min(3, Math.ceil(manuscripts * 0.12)), clean, (r) => {
      const length = Math.max(2, Math.round((lines * roleRng.range(3, 8)) / 100));
      const first = Math.max(2, Math.round((lines * roleRng.range(30, 70)) / 100));
      r.loss = [first, Math.min(lines - 1, first + length - 1)];
    });
    let k = 0;
    assign(Math.min(5, Math.ceil(manuscripts * 0.2)), clean, (r) => {
      r.partial =
        k++ % 2 === 0
          ? [1, Math.max(5, Math.round((lines * roleRng.range(35, 55)) / 100))]
          : stretch(30, 70);
    });
    assign(
      manuscripts >= 4 ? 2 : 0,
      (r) => !r.partial,
      (r) => (r.scholia = true),
    );
    assign(
      manuscripts >= 4 ? Math.min(3, Math.floor(manuscripts / 4)) : 0,
      (r) => !r.partial && !r.loss,
      (r) => {
        const length = Math.min(100, Math.max(5, Math.floor(lines / 6)));
        const from = roleRng.range(1, Math.max(1, lines - length));
        r.contaminated = { from, to: from + length, family: -1 };
      },
    );
    assign(
      manuscripts >= 4 ? 2 : 0,
      () => true,
      (r) => (r.unplaced = Math.min(30, Math.floor(lines / 4))),
    );
    assign(
      1,
      (r) => !r.unplaced,
      (r) => (r.noPages = true),
    );
  }
  // The manuscripts that abbreviate are two of those that keep a diplomatic form.
  roles
    .filter((r) => r.diplomatic !== 'none')
    .slice(0, 2)
    .forEach((r) => (r.abbreviations = true));

  // Family of each manuscript, round the families; contamination follows another family.
  const familyOf = Array.from({ length: manuscripts }, (_, i) => i % families);
  roles.forEach((r, i) => {
    if (r.contaminated)
      r.contaminated.family =
        (familyOf[i]! + 1 + roleRng.int(Math.max(1, families - 1))) % families;
  });

  // Overlaps: a place where one manuscript has a different version of three or four words, and two others differ from the text in one word each, at different words.
  interface Overlap {
    line: number;
    wide: number;
    narrow: [number, number];
    from: number;
    length: number;
    narrowAt: [number, number];
  }
  const overlaps: Overlap[] = [];
  const overlapRng = root.fork('overlaps');
  const complete = Array.from({ length: manuscripts }, (_, i) => i).filter(
    (i) => i > 0 && !roles[i]!.partial && !roles[i]!.loss,
  );
  if (complete.length >= 3) {
    const count = Math.max(1, Math.round((lines / 100) * OVERLAPS_PER_HUNDRED));
    const used = new Set<number>();
    for (let k = 0; k < count && scale > 0; k++) {
      const n = overlapRng.range(1, lines);
      if (used.has(n) || base[n - 1]!.length < 6) continue;
      used.add(n);
      const [wide, a, b] = overlapRng.shuffle(complete).slice(0, 3) as [number, number, number];
      const length = overlapRng.range(3, 4);
      const from = overlapRng.range(0, base[n - 1]!.length - length);
      const [x, y] = overlapRng.shuffle(Array.from({ length }, (_, j) => from + j)).slice(0, 2) as [
        number,
        number,
      ];
      overlaps.push({ line: n, wide, narrow: [a, b], from, length, narrowAt: [x, y] });
    }
  }

  // The manuscripts.
  const witnesses: StressWitness[] = [];
  const baseWitnessWords: string[][] = [];
  for (let m = 0; m < manuscripts; m++) {
    const rng = root.fork(`ms${m}`);
    const role = roles[m]!;
    const key = `ms${String(m + 1).padStart(2, '0')}`;
    const siglum = siglumOf(m);
    const family = familyOf[m]!;
    const from = role.partial ? role.partial[0] : 1;
    const to = role.partial ? role.partial[1] : lines;
    // The words of each line this manuscript reads, in order, with lines lost between.
    interface Slot {
      n: number;
      words: string[];
    }
    const slots: (Slot | StressLost)[] = [];
    const lossFrom = role.loss ? role.loss[0] : -1;
    const lossTo = role.loss ? role.loss[1] : -1;
    for (let n = from; n <= to; n++) {
      if (n >= lossFrom && n <= lossTo) {
        if (n === lossFrom) slots.push({ kind: 'lost', lines: lossTo - lossFrom + 1 });
        continue;
      }
      const contaminated =
        role.contaminated && n >= role.contaminated.from && n <= role.contaminated.to;
      const source = ancestors[contaminated ? role.contaminated!.family : family]!;
      const copied = source.lines[n - 1];
      if (copied === null || copied === undefined) continue;
      if (rng.chance(RATES.lineOmission * scale * OWN_STAGE)) continue;
      slots.push({ n, words: perturbLine(copied, scale * OWN_STAGE, rng) });
    }
    // Neighbouring lines in the other order: the ancestor's, and the manuscript's own.
    for (let i = 0; i + 1 < slots.length; i++) {
      const a = slots[i]!;
      const b = slots[i + 1]!;
      if ('kind' in a || 'kind' in b || b.n !== a.n + 1) continue;
      const ancestral = ancestors[family]!.swapped[a.n - 1];
      if (ancestral || rng.chance(RATES.lineSwap * scale * OWN_STAGE)) {
        [slots[i], slots[i + 1]] = [b, a];
        i++;
      }
    }
    // Overlaps this manuscript takes part in: the line reads as the text but for the one difference.
    for (const o of overlaps) {
      const slot = slots.find((s): s is Slot => !('kind' in s) && s.n === o.line);
      if (!slot) continue;
      const text = base[o.line - 1]!;
      if (m === 0) {
        slot.words = [...text];
      } else if (m === o.wide) {
        slot.words = [...text];
        for (let j = o.from; j < o.from + o.length; j++)
          slot.words[j] = substituteFor(text[j]!, text, rng);
      } else if (m === o.narrow[0] || m === o.narrow[1]) {
        const j = o.narrowAt[m === o.narrow[0] ? 0 : 1];
        slot.words = [...text];
        slot.words[j] = substituteFor(text[j]!, text, rng);
      }
    }
    if (m === 0) {
      for (const slot of slots) if (!('kind' in slot)) baseWitnessWords[slot.n - 1] = slot.words;
    }

    // Corrections, variants in the margin, abbreviations: decided per line, written as items.
    const hands: StressHand[] = [hand(`${key}-h1`, 'Scribe', true)];
    const states: StressState[] = [];
    const roleNames: string[] = [];
    let variantSiglum: string | null = null;
    if (role.corrected === 1) {
      hands.push(hand(`${key}-h2`, 'm2', false), hand(`${key}-h3`, 'm3', false));
      states.push(
        { kind: 'original', siglum: `${siglum}ac` },
        { kind: 'hand', hand: `${key}-h2`, siglum: `${siglum}2` },
        { kind: 'hand', hand: `${key}-h3`, siglum: `${siglum}3` },
      );
      roleNames.push('corrected by the scribe, m2 and m3');
    } else if (role.corrected === 2) {
      hands.push(hand(`${key}-h2`, 'm2', false));
      states.push(
        { kind: 'original', siglum: `${siglum}ac` },
        { kind: 'stage', stage: 1, siglum: `${siglum}s1` },
      );
      roleNames.push('corrected in two stages');
    }
    if (role.variants) {
      variantSiglum = `${siglum}γρ`;
      roleNames.push('variants noted in the margin');
    }
    if (role.abbreviations) roleNames.push('abbreviations');
    if (role.partial) roleNames.push(`covers lines ${role.partial[0]} to ${role.partial[1]}`);
    if (role.loss) roleNames.push(`lacks lines ${role.loss[0]} to ${role.loss[1]}`);
    if (role.contaminated)
      roleNames.push(
        `follows family ${role.contaminated.family + 1} for lines ${role.contaminated.from} to ${role.contaminated.to}`,
      );
    if (role.scholia) roleNames.push('carries scholia');
    if (role.unplaced) roleNames.push(`first ${role.unplaced} lines on no page`);
    if (role.noPages) roleNames.push('no pages');
    if (role.diplomatic !== 'none') roleNames.push(`diplomatic form in ${role.diplomatic}`);
    if (m === 0) roleNames.push('base of the edition');
    let groupCounter = 0;
    const entries: StressEntry[] = [];
    const scholiaAfter = new Map(scholia.map((s) => [s.after, s]));
    for (const slot of slots) {
      if ('kind' in slot) {
        entries.push(slot);
        continue;
      }
      const items = lineItems(slot.words, base[slot.n - 1]!, {
        rng,
        style: role.diplomatic,
        corrected: role.corrected,
        key,
        scale,
        variants: !!role.variants,
        abbreviations: !!role.abbreviations,
        group: () => `g${m}-${++groupCounter}`,
      });
      decorate(items, rng, { unclear: SPRINKLES.unclear, key, hands, edge: true });
      entries.push({ kind: 'line', work: 'main', number: slot.n, items });
      const scholium = role.scholia ? scholiaAfter.get(slot.n) : undefined;
      if (scholium) {
        const words = perturbLine(scholium.words, scale * 3, rng);
        const items = words.map((w) => ({ kind: 'word' as const, ...writtenWord(w, 'none', rng) }));
        entries.push({ kind: 'line', work: 'scholia', number: scholium.number, items });
      }
    }
    const { pages, pageOf } = codexPages(entries, role);
    witnesses.push({
      key,
      siglum,
      name: `Manuscript ${siglum}`,
      type: 'manuscript',
      family,
      hands,
      keepsWrittenForm: role.diplomatic !== 'none',
      diplomatic: role.diplomatic,
      pages,
      entries,
      pageOf,
      states,
      variantSiglum,
      roles: roleNames,
    });
  }

  // The papyri: short, and broken in every line.
  for (let p = 0; p < papyri; p++) {
    const rng = root.fork(`pap${p}`);
    const key = `pap${p + 1}`;
    const length = Math.min(lines, rng.range(40, 120));
    const start = rng.range(1, lines - length + 1);
    const family = p % families;
    const columns = p % 2 === 0;
    const entries: StressEntry[] = [];
    const pageOf: (number | null)[] = [];
    const pages: string[] = [];
    const end = start + length - 1;
    // A fragment or a column at a time; between two fragments some lines are lost, between columns now and then.
    for (let n = start, page = 0; n <= end; page++) {
      pages.push(columns ? `col. ${roman(page)}` : `fr. ${String.fromCharCode(97 + (page % 26))}`);
      const size = Math.min(end - n + 1, columns ? PAGE_LINES : rng.range(8, 30));
      for (let k = 0; k < size; k++, n++) {
        const copied = ancestors[family]!.lines[n - 1];
        if (copied === null || copied === undefined) continue;
        const words = perturbLine(copied, scale * OWN_STAGE, rng);
        const items = lineItems(words, base[n - 1]!, {
          rng,
          style: 'capitals',
          key,
          scale,
          variants: false,
          abbreviations: false,
          group: () => '',
        });
        decorate(items, rng, { unclear: SPRINKLES.unclearPapyrus, key, hands: [], edge: false });
        damage(items, rng);
        entries.push({ kind: 'line', work: 'main', number: n, items });
        pageOf.push(page);
      }
      if (n < end && (!columns || rng.chance(0.34))) {
        const lost = Math.min(rng.range(1, 10), end - n);
        entries.push({ kind: 'lost', lines: lost });
        pageOf.push(page);
        n += lost;
      }
    }
    witnesses.push({
      key,
      siglum: `Π${p + 1}`,
      name: `Papyrus ${p + 1}`,
      type: 'papyrus',
      family,
      hands: [hand(`${key}-h1`, 'Scribe', true)],
      keepsWrittenForm: true,
      diplomatic: 'capitals',
      pages,
      entries,
      pageOf,
      states: [],
      variantSiglum: null,
      roles: [`papyrus roll, lines ${start} to ${start + length - 1}, damaged in every line`],
    });
  }

  // The witness known only from what is reported of it.
  const reportedList: StressReported[] = [];
  if (reported > 0) {
    const rng = root.fork('reported');
    witnesses.push({
      key: 'rep1',
      siglum: 'Σ',
      name: 'Reported witness',
      type: 'reported',
      family: null,
      hands: [],
      keepsWrittenForm: false,
      diplomatic: 'none',
      pages: [],
      entries: [],
      pageOf: [],
      states: [],
      variantSiglum: null,
      roles: ['never transcribed, known from reported readings'],
    });
    const count = Math.max(4, Math.round((lines * 40) / DEFAULT_LINES));
    const chosen = new Set<number>();
    while (chosen.size < Math.min(count, lines)) chosen.add(rng.range(1, lines));
    for (const n of [...chosen].sort((a, b) => a - b)) {
      const words = baseWitnessWords[n - 1] ?? base[n - 1]!;
      const at = rng.int(words.length);
      const span = rng.chance(0.3) && at + 1 < words.length ? 2 : 1;
      const lemma = words.slice(at, at + span).join(' ');
      reportedList.push({
        witness: 'rep1',
        line: n,
        lemma,
        reading: words
          .slice(at, at + span)
          .map((w) => substituteFor(w, words, rng))
          .join(' '),
        source: rng.pick([
          'Athenaeus 1.12e',
          'Stobaeus 3.1.4',
          'Plutarch, Moralia 28a',
          'a lexicon s.v.',
        ]),
      });
    }
  }

  const bibliography = makeBibliography(root.fork('bibliography'), lines);
  const conjectures = makeConjectures(
    root.fork('conjectures'),
    lines,
    baseWitnessWords,
    base,
    bibliography.length,
  );
  const editors = makeEditorPlan(
    root.fork('editors'),
    lines,
    baseWitnessWords,
    bibliography.length,
  );

  return {
    lines,
    seed,
    base,
    witnesses,
    scholia,
    reported: reportedList,
    conjectures,
    bibliography,
    editors,
    baseWitness: witnesses[0]!.key,
    baseWitnessWords,
  };
}

// A line as items

interface LineContext {
  rng: Random;
  style: 'none' | 'capitals' | 'itacistic';
  key: string;
  scale: number;
  corrected?: 1 | 2 | undefined;
  variants: boolean;
  abbreviations: boolean;
  group: () => string;
}

type WordItem = Extract<StressItem, { kind: 'word' }>;

/** The words of a line as written items, with corrections, margin variants and abbreviations where this witness has them. */
function lineItems(
  words: readonly string[],
  text: readonly string[],
  c: LineContext,
): StressItem[] {
  const { rng } = c;
  const out: StressItem[] = words.map((w) => ({ kind: 'word', ...writtenWord(w, c.style, rng) }));
  const wordAt = (i: number) => out[i] as WordItem;
  // Corrections: the scribe's word deleted and the corrector's written beside it, a deletion alone, an addition alone.
  if (c.corrected && rng.chance(SPRINKLES.correction * (c.scale > 0 ? 1 : 0))) {
    const i = rng.int(words.length);
    const handChoices = c.corrected === 1 ? ['scribe', 'h2', 'h3'] : ['scribe', 'h2'];
    const weights = c.corrected === 1 ? [0.3, 0.5, 0.2] : [0.6, 0.4];
    let roll = rng.next();
    let which = 0;
    while (which < weights.length - 1 && roll >= weights[which]!) roll -= weights[which++]!;
    const handChoice = handChoices[which]!;
    const handId = handChoice === 'scribe' ? 'scribe' : `${c.key}-${handChoice}`;
    const seq = which + 1;
    const del = (item: WordItem): void => {
      item.marks = [
        ...(item.marks ?? []),
        { kind: 'del', attrs: { hand: handId, seq, rend: 'strikethrough' } },
      ];
    };
    const add = (item: WordItem): void => {
      item.marks = [
        ...(item.marks ?? []),
        { kind: 'add', attrs: { hand: handId, seq, place: 'above' } },
      ];
    };
    const kind = rng.next();
    if (kind < 0.7) {
      // The corrector restores the text where the scribe departed from it, else writes another word.
      const restores = words.length === text.length && words[i] !== text[i];
      const reading = restores ? text[i]! : substituteFor(words[i]!, words, rng);
      const added: WordItem = { kind: 'word', ...writtenWord(reading, c.style, rng) };
      del(wordAt(i));
      add(added);
      out.splice(i + 1, 0, added);
    } else if (kind < 0.85) {
      del(wordAt(i));
    } else {
      const added: WordItem = {
        kind: 'word',
        ...writtenWord(otherWord('', words, rng), c.style, rng),
      };
      add(added);
      out.splice(i, 0, added);
    }
  }
  // A variant the scribe notes in the margin over one to three words.
  if (c.variants && rng.chance(SPRINKLES.variant * (c.scale > 0 ? 1 : 0))) {
    const span = rng.range(1, Math.min(3, words.length));
    const start = rng.int(out.length - span + 1);
    const covered = out.slice(start, start + span) as WordItem[];
    if (
      covered.every(
        (item) =>
          item.kind === 'word' &&
          !(item.marks ?? []).some((m) => m.kind === 'del' || m.kind === 'add'),
      )
    ) {
      const readings = covered.map((item) => {
        const read = item.norm ?? item.form;
        return substituteFor(read, words, rng);
      });
      const reading = rng.chance(0.1) ? '' : readings.join(' ');
      const group = c.group();
      for (const item of covered)
        item.marks = [
          ...(item.marks ?? []),
          {
            kind: 'variant',
            attrs: { group, reading, place: rng.pick(['margin', 'interlinear']) },
          },
        ];
    }
  }
  // Abbreviations: the word written short, read in full.
  if (c.abbreviations) {
    for (const item of out) {
      if (item.kind !== 'word' || (item.marks ?? []).length > 0) continue;
      if (!rng.chance(SPRINKLES.abbreviation)) continue;
      const read = item.norm ?? item.form;
      const full = splitPunctuation(read).bare;
      const chars = Array.from(capitals(full));
      if (chars.length < 4) continue;
      item.form = chars[0]! + chars[chars.length - 1]!;
      item.norm = read;
      item.marks = [{ kind: 'abbr', attrs: { expan: full } }];
    }
  }
  return out;
}

function wordsOf(items: StressItem[]): WordItem[] {
  return items.filter((i): i is WordItem => i.kind === 'word');
}

/** Unclear letters, and here and there a note, a paragraphos, a space, a change of hand. */
function decorate(
  items: StressItem[],
  rng: Random,
  c: { unclear: number; key: string; hands: StressHand[]; edge: boolean },
): void {
  for (const item of wordsOf(items)) {
    if (!rng.chance(c.unclear)) continue;
    const length = Array.from(item.form).length;
    const mark: StressMark = { kind: 'unclear' };
    if (length >= 3 && rng.chance(0.5)) {
      mark.from = rng.range(0, length - 2);
      mark.to = Math.min(length, mark.from + rng.range(1, 3));
    }
    item.marks = [...(item.marks ?? []), mark];
  }
  if (!c.edge) return;
  const words = wordsOf(items);
  if (c.hands.length > 1 && rng.chance(SPRINKLES.handShift) && words.length > 0) {
    const target = rng.pick(words);
    target.marks = [
      ...(target.marks ?? []),
      { kind: 'handShift', attrs: { new: `#${c.hands[1]!.id}` } },
    ];
  }
  if (rng.chance(SPRINKLES.space) && items.length > 1)
    items.splice(rng.range(1, items.length - 1), 0, {
      kind: 'object',
      type: 'space',
      attrs: { quantity: rng.range(2, 6), unit: 'character' },
    });
  if (rng.chance(SPRINKLES.paragraphos))
    items.push({ kind: 'object', type: 'mark', attrs: { type: 'paragraphos' } });
  if (rng.chance(SPRINKLES.note))
    items.push({
      kind: 'object',
      type: 'note',
      attrs: { place: 'margin' },
      text: rng.pick(['σημείωσαι', 'ἀντίγραφον', 'ζήτει', 'ἄλλως']),
    });
}

/** A papyrus line, damaged: a gap at its start or end, a word broken by a gap, an illegible word. */
function damage(items: StressItem[], rng: Random): void {
  const gap = (reason: 'lost' | 'illegible', quantity: number): StressItem => ({
    kind: 'gap',
    attrs: { reason, unit: 'character', quantity },
  });
  let start = rng.chance(SPRINKLES.papyrusStart);
  let end = rng.chance(SPRINKLES.papyrusEnd);
  const broken = rng.chance(SPRINKLES.papyrusBroken);
  const illegible = rng.chance(SPRINKLES.papyrusIllegible);
  const words = wordsOf(items);
  let damaged = false;
  if (broken && words.length > 2) {
    const item = rng.pick(words.slice(1, -1));
    const chars = Array.from(item.form);
    if (chars.length >= 3) {
      const keep = rng.range(1, chars.length - 1);
      const fromStart = rng.chance(0.5);
      item.form = (fromStart ? chars.slice(0, keep) : chars.slice(chars.length - keep)).join('');
      delete item.norm;
      damaged = true;
      const point = fromStart ? keep : 0;
      item.marks = [
        ...(item.marks ?? []).filter((m) => m.kind !== 'unclear' && m.kind !== 'abbr'),
        {
          kind: 'gap',
          from: point,
          to: point,
          attrs: {
            reason: rng.chance(0.7) ? 'lost' : 'illegible',
            unit: 'character',
            quantity: rng.range(1, 4),
          },
        },
      ];
    }
  }
  if (illegible && items.length > 2) {
    items.splice(rng.range(1, items.length - 1), 0, gap('illegible', rng.range(1, 3)));
    damaged = true;
  }
  // Every line of a papyrus is damaged: a line with no damage so far loses its start or its end.
  if (!damaged && !start && !end) {
    if (rng.chance(0.5)) start = true;
    else end = true;
  }
  if (start) items.unshift(gap('lost', rng.range(2, 9)));
  if (end) items.push(gap('lost', rng.range(2, 9)));
}

/** Pages of a codex: 25 lines to a page, the first lines on none for some, no pages at all for one. */
function codexPages(
  entries: StressEntry[],
  role: Role,
): { pages: string[]; pageOf: (number | null)[] } {
  if (role.noPages) return { pages: [], pageOf: entries.map(() => null) };
  const pageOf: (number | null)[] = [];
  let count = 0;
  const unplaced = role.unplaced ?? 0;
  let current: number | null = null;
  for (const entry of entries) {
    if (entry.kind === 'line' && entry.work === 'main') {
      current = count < unplaced ? null : Math.floor((count - unplaced) / PAGE_LINES);
      count++;
    }
    pageOf.push(current);
  }
  const used = Math.max(-1, ...pageOf.map((p) => p ?? -1)) + 1;
  return { pages: Array.from({ length: used }, (_, i) => codexLabel(i)), pageOf };
}

// Conjectures, the bibliography and the editors' plan

function makeBibliography(rng: Random, lines: number): StressBibliography[] {
  const count = Math.max(8, Math.round((40 * Math.max(lines, 400)) / DEFAULT_LINES));
  const out: StressBibliography[] = [];
  for (let i = 0; i < Math.min(count, 40); i++) {
    const surname = SURNAMES[i % SURNAMES.length]!;
    const year = String(1840 + rng.int(180));
    const entryType = rng.pick(['book', 'article', 'incollection'] as const);
    const title = `On ${rng.pick(WORDS_FOR_TITLES)} in the ${rng.pick(WORDS_FOR_TITLES)} of the ${rng.pick(WORDS_FOR_TITLES)}`;
    const fields: Record<string, string> =
      entryType === 'book'
        ? {
            author: `${surname}, ${rng.pick(['A.', 'B.', 'C.', 'D.'])}`,
            title,
            date: year,
            location: 'Oxford',
          }
        : entryType === 'article'
          ? {
              author: `${surname}, ${rng.pick(['E.', 'F.', 'G.'])}`,
              title,
              journaltitle: `Journal of ${rng.pick(WORDS_FOR_TITLES)} Studies`,
              date: year,
              pages: `${rng.range(1, 300)}-${rng.range(301, 340)}`,
            }
          : {
              author: `${surname}, ${rng.pick(['H.', 'K.', 'L.'])}`,
              title,
              booktitle: `Studies in ${rng.pick(WORDS_FOR_TITLES)}`,
              date: year,
              location: 'Cambridge',
            };
    out.push({
      index: i,
      key: `stress-${surname.toLowerCase()}${year}-${i}`,
      entryType,
      fields,
      label: `${surname} ${year}`,
    });
  }
  return out;
}

const WORDS_FOR_TITLES = [
  'Tragedy',
  'Lyric',
  'Chorus',
  'Metre',
  'Scholia',
  'Papyri',
  'Recension',
  'Tradition',
  'Corruption',
  'Interpolation',
  'Diction',
  'Syntax',
];

function makeConjectures(
  rng: Random,
  lines: number,
  baseWitnessWords: string[][],
  base: string[][],
  bibliographyCount: number,
): StressConjecture[] {
  const total = Math.max(12, Math.round((120 * lines) / DEFAULT_LINES));
  const share: [StressConjectureKind, number][] = [
    ['substitution', 0.45],
    ['deletion', 0.12],
    ['addition', 0.12],
    ['lacuna', 0.1],
    ['supplement', 0.1],
    ['transposition', 0.06],
  ];
  // Counts by share, the rest to the substitutions, so that the total is as asked.
  const counts = share.map(([, fraction]) => Math.max(1, Math.floor(total * fraction)));
  counts[0]! += total - counts.reduce((a, b) => a + b, 0);
  const kinds: StressConjectureKind[] = [];
  share.forEach(([kind], i) => {
    for (let k = counts[i]!; k > 0; k--) kinds.push(kind);
  });
  const wordsOn = (n: number) => baseWitnessWords[n - 1] ?? base[n - 1]!;
  const out: StressConjecture[] = [];
  const lacunae: number[] = [];
  // Lacunae first, so that supplements have one to fill; then the rest in the order of the text.
  const ordered = [...kinds].sort((a, b) => (a === 'lacuna' ? -1 : b === 'lacuna' ? 1 : 0));
  const lineChoices = Array.from({ length: ordered.length }, () =>
    rng.range(1, Math.max(2, lines - 1)),
  );
  ordered.forEach((kind, k) => {
    let line = lineChoices[k]!;
    let supplements: number | null = null;
    if (kind === 'supplement' && lacunae.length > 0) {
      supplements = rng.pick(lacunae);
      line = out[supplements]!.line;
    }
    const words = wordsOn(line);
    const at = rng.int(words.length);
    const span = rng.chance(0.25) && at + 1 < words.length ? 2 : 1;
    const lemmaWords = words.slice(at, at + span);
    let lemma = lemmaWords.join(' ');
    let reading = '';
    let sequence: number[] | null = null;
    const occurrences = words.filter((w) => w === words[at]).length;
    switch (kind) {
      case 'substitution':
        reading = lemmaWords.map((w) => substituteFor(w, words, rng)).join(' ');
        break;
      case 'deletion':
        break;
      case 'addition':
        lemma = '';
        reading = otherWord('', words, rng);
        break;
      case 'lacuna':
        lemma = rng.chance(0.5) ? lemma : '';
        break;
      case 'supplement':
        lemma = '';
        reading = [otherWord('', words, rng), otherWord('', words, rng)].join(' ');
        break;
      case 'transposition':
        lemma = words.slice(0, 3).join(' ');
        sequence = [line + 1, line];
        break;
    }
    const conjecture: StressConjecture = {
      index: out.length,
      line,
      kind,
      lemma,
      reading,
      proposer: rng.pick(PROPOSERS),
      note: rng.chance(0.4)
        ? rng.pick([
            'The word does not scan.',
            'Proposed for the sake of the sense.',
            'Compare the usage in the preceding lines.',
            'Needed by the construction.',
            'Not in any witness, but easily corrupted.',
          ])
        : null,
      sequence,
      supplements,
      anchorWord: lemma !== '' && occurrences > 1 ? at : null,
      cites: rng.chance(0.3) && bibliographyCount > 0 ? [rng.int(bibliographyCount)] : [],
      adopt: false,
    };
    if (kind === 'lacuna') lacunae.push(out.length);
    out.push(conjecture);
  });
  // A few conjectures that name words the text does not have (the lemma no longer attaches).
  for (const c of out.filter((c) => c.lemma !== '' && c.kind !== 'transposition'))
    if (rng.chance(0.05)) c.lemma = `${c.lemma}${KORONIS}ξ`;
  // The editors adopt about a fifth, of every kind.
  const adoptShare: Record<StressConjectureKind, number> = {
    substitution: 0.15,
    deletion: 0.25,
    addition: 0.25,
    lacuna: 0.25,
    supplement: 0.25,
    transposition: 0.4,
  };
  for (const kind of Object.keys(adoptShare) as StressConjectureKind[]) {
    const ofKind = out.filter((c) => c.kind === kind);
    const wanted = Math.max(1, Math.round(ofKind.length * adoptShare[kind]));
    for (const c of ofKind.slice(0, wanted)) c.adopt = true;
  }
  // A supplement is adopted with the lacuna it fills.
  for (const c of out) if (c.adopt && c.supplements !== null) out[c.supplements]!.adopt = true;
  // In the order of the text; a supplement keeps naming the lacuna it fills.
  const order = out.map((_, i) => i).sort((a, b) => out[a]!.line - out[b]!.line || a - b);
  const renumbered = new Map(order.map((old, i) => [old, i] as const));
  return order.map((old, index) => ({
    ...out[old]!,
    index,
    supplements: out[old]!.supplements === null ? null : renumbered.get(out[old]!.supplements!)!,
  }));
}

function makeEditorPlan(
  rng: Random,
  lines: number,
  baseWitnessWords: string[][],
  bibliographyCount: number,
): StressEditorPlan {
  const speakers: { line: number; text: string }[] = [];
  for (let n = rng.range(5, 15); n <= lines; n += rng.range(12, 18))
    speakers.push({ line: n, text: rng.pick(SPEAKERS) });
  const headings: { line: number; text: string }[] = [];
  const headingCount = Math.max(1, Math.round((lines * 10) / DEFAULT_LINES));
  for (let k = 0; k < headingCount; k++)
    headings.push({
      line: Math.max(2, Math.round(((k + 0.5) * lines) / headingCount)),
      text: `${HEADINGS[k % HEADINGS.length]!}${k >= HEADINGS.length ? ` ${k}` : ''}`,
    });
  const wordCount = (n: number) => (baseWitnessWords[n - 1] ?? []).length || 5;
  const pick = (count: number) => {
    const chosen = new Map<number, number>();
    while (chosen.size < Math.min(count, lines - 1)) {
      const line = rng.range(2, lines);
      if (!chosen.has(line)) chosen.set(line, rng.int(wordCount(line)));
    }
    return [...chosen].sort((a, b) => a[0] - b[0]);
  };
  const scaled = (n: number) => Math.max(2, Math.round((n * lines) / DEFAULT_LINES));
  return {
    speakers,
    headings,
    cruces: pick(scaled(10)).map(([line, word]) => ({ line, word })),
    emendations: pick(scaled(15)).map(([line, word], i) => ({
      line,
      word,
      reading: rng.pick(VOCABULARY),
      register: i % 2 === 0,
    })),
    notes: pick(scaled(30)).map(([line, word]) => ({
      line,
      word: rng.chance(0.7) ? word : null,
      text: rng.pick([
        'The reading of the base is retained against the majority.',
        'The line is attested in the indirect tradition with another order of words.',
        'Perhaps the beginning of a speech; the manuscripts give no change of speaker.',
        'The metre requires a short syllable here.',
        'The scholia explain the word otherwise.',
      ]),
      cites: rng.chance(0.4) && bibliographyCount > 0 ? [rng.int(bibliographyCount)] : [],
    })),
  };
}

// A summary, for tests and for the report of the seeder

export interface StressSummary {
  lines: number;
  witnesses: number;
  manuscripts: number;
  papyri: number;
  reported: number;
  words: number;
  /** For each manuscript, the share of the lines it has whose read words differ from the text's. */
  differing: Record<string, number>;
  conjectures: Record<string, number>;
}

/** What was made, in numbers. */
export function summarizeStress(text: StressText): StressSummary {
  const differing: Record<string, number> = {};
  let words = 0;
  for (const w of text.witnesses) {
    let lines = 0;
    let differs = 0;
    for (const entry of w.entries) {
      if (entry.kind !== 'line' || entry.work !== 'main') continue;
      const read = wordsOf(entry.items)
        .filter((i) => !(i.marks ?? []).some((m) => m.kind === 'del'))
        .map((i) => i.norm ?? i.form);
      words += read.length;
      lines++;
      if (read.join(' ') !== text.base[entry.number - 1]!.join(' ')) differs++;
    }
    if (w.type === 'manuscript' && lines > 0) differing[w.key] = differs / lines;
  }
  const conjectures: Record<string, number> = {};
  for (const c of text.conjectures) conjectures[c.kind] = (conjectures[c.kind] ?? 0) + 1;
  return {
    lines: text.lines,
    witnesses: text.witnesses.length,
    manuscripts: text.witnesses.filter((w) => w.type === 'manuscript').length,
    papyri: text.witnesses.filter((w) => w.type === 'papyrus').length,
    reported: text.witnesses.filter((w) => w.type === 'reported').length,
    words,
    differing,
    conjectures,
  };
}
