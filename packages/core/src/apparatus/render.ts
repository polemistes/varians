/**
 * The apparatus: the account of a segment's sites as an edition prints it.
 * Pure rendering of collation results plus the conjectures and reported
 * readings attached to each site.
 */

import type { Collation, Reading, Site, SiteKind } from '../collate/collate.ts';
import { archetypeLetters, trimPunctuation } from '../normalize/fold.ts';

export interface ApparatusConventions {
  /** Positive: name the witnesses that agree with the lemma. Negative: name only those that differ. */
  form: 'positive' | 'negative';
  /** Latin abbreviations (om., add., del.) rather than English words. */
  latin: boolean;
  /**
   * Interpretative variants (the same letters read otherwise): among the
   * others, in a list of their own under the apparatus, or not printed.
   */
  interpretative: InterpretativePlacement;
}

export type InterpretativePlacement = 'apparatus' | 'separate' | 'none';

export const DEFAULT_CONVENTIONS: ApparatusConventions = { form: 'positive', latin: true, interpretative: 'separate' };

/** A conjecture or reported reading attached to a site for printing. */
export interface Attachment {
  kind: 'conjecture' | 'reported';
  /** The reading proposed or reported; empty for a deletion or a lacuna. */
  text: string;
  /** Proposer of a conjecture, or the siglum of the witness a reading is reported for. */
  name: string;
  /** The kind of conjecture, when one. */
  conjectureKind?: 'substitution' | 'deletion' | 'addition' | 'lacuna' | 'supplement' | 'transposition';
  /** Printed after the name: "(Ath. 1.12e)", "(teste Allen)". */
  source?: string;
  /** The edition prints it. */
  adopted?: boolean;
  id: string;
}

export interface ApparatusEntry {
  siteIndex: number;
  /** The segment label the entry stands under. */
  label: string;
  /** The lemma: the edition's words, or empty for an addition site. */
  lemma: string;
  /** Sigla agreeing with the lemma (positive form), base excluded. */
  lemmaSigla: string[];
  /** Each printed alternative, in order. */
  variants: ApparatusVariant[];
  /** A conjecture the edition adopted here, printed as the lemma's source. */
  adopted?: Attachment;
  /** A transposition statement, when the site is one half. */
  transposition?: string;
  /** Textual, or interpretative: everything printed here has the lemma's letters. */
  kind: SiteKind;
}

export interface ApparatusVariant {
  text: string;
  sigla: string[];
  /** Printed in place of text for omissions, additions, lacunae. */
  note?: string;
  lacunose: boolean;
  attachment?: Attachment;
}

const words = {
  om: { latin: 'om.', english: 'omitted' },
  add: { latin: 'add.', english: 'added' },
  del: { latin: 'del.', english: 'deleted' },
  lac: { latin: 'lac.', english: 'lacuna in' },
  deest: { latin: 'deest in', english: 'absent in' },
  coni: { latin: 'coni.', english: 'conjectured' },
  suppl: { latin: 'suppl.', english: 'supplied' },
  transp: { latin: 'transp.', english: 'transposed' },
  post: { latin: 'post', english: 'after' },
  codd: { latin: 'codd.', english: 'all witnesses' },
};

function word(key: keyof typeof words, latin: boolean): string {
  return latin ? words[key].latin : words[key].english;
}

/**
 * Entries for one segment: one per site that the conventions print, with
 * the attachments placed by their site index.
 */
export function apparatusEntries(
  collation: Collation,
  label: string,
  attachments: Record<number, Attachment[]>,
  conventions: ApparatusConventions = DEFAULT_CONVENTIONS,
  siglaOrder: string[] = [],
): ApparatusEntry[] {
  const entries: ApparatusEntry[] = [];
  const baseCount = collation.columns.filter((c) => (c.cells.get(collation.baseId)?.unitIndex ?? -1) >= 0).length;
  for (const site of collation.sites) {
    const base = site.readings.find((r) => r.base);
    const others = site.readings.filter((r) => !r.base);
    const attached = attachments[site.index] ?? [];
    if (others.length === 0 && attached.length === 0) continue;
    const kind = printedKind(site, attached);
    if (kind === 'interpretative' && conventions.interpretative === 'none') continue;
    const printable = others;
    const adopted = attached.find((a) => a.adopted);
    // A site over the whole segment: what a witness lacks there it lacks entirely.
    const whole = base !== undefined && baseCount > 0 && site.baseFrom === 0 && site.baseTo === baseCount;
    const variants: ApparatusVariant[] = printable.map((reading) => renderReading(reading, base, conventions, siglaOrder, whole));
    for (const attachment of attached) {
      if (attachment.adopted) continue;
      variants.push(renderAttachment(attachment, conventions));
    }
    const entry: ApparatusEntry = {
      siteIndex: site.index,
      label,
      lemma: base ? lemmaOf(base, whole && others.every((r) => r.text === '' && (r.omission || r.lacunose))) : '',
      // The edition's own siglum comes first and is not printed.
      lemmaSigla: base ? sortSigla(printedSigla(base).slice(1), siglaOrder) : [],
      variants,
      kind,
    };
    if (adopted) entry.adopted = adopted;
    if (site.transposition && site.transposition.withSite !== site.index) {
      entry.transposition = `${word('transp', conventions.latin)} ${site.transposition.textIds.length} `.trim();
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * An entry is interpretative when its site is and every conjecture or
 * reported reading there has the lemma's letters too: a conjecture of other
 * words makes it textual, whatever the witnesses have.
 */
export function printedKind(site: Site, attached: Pick<Attachment, 'text'>[]): SiteKind {
  if (site.kind === 'textual') return 'textual';
  if (attached.length === 0) return 'interpretative';
  const letters = archetypeLetters(site.readings.find((r) => r.base)?.text ?? '');
  return attached.every((a) => a.text !== '' && archetypeLetters(a.text) === letters) ? 'interpretative' : 'textual';
}

/**
 * The entries as printed: the textual ones, and the interpretative ones
 * among them or in a list of their own, as the conventions say.
 */
export function splitEntries(entries: ApparatusEntry[], conventions: Pick<ApparatusConventions, 'interpretative'>): { main: ApparatusEntry[]; interpretative: ApparatusEntry[] } {
  if (conventions.interpretative === 'apparatus') return { main: entries, interpretative: [] };
  const main: ApparatusEntry[] = [];
  const interpretative: ApparatusEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'textual') main.push(entry);
    else if (conventions.interpretative === 'separate') interpretative.push(entry);
  }
  return { main, interpretative };
}

/**
 * The lemma: the base's words; for a site over a whole segment of more than
 * three words where every witness lacks it, its first and last words with
 * an ellipsis between.
 */
function lemmaOf(base: Reading, abridge: boolean): string {
  const text = trimPunctuation(base.text);
  if (!abridge) return text;
  const parts = text.split(/\s+/u).filter((p) => p !== '');
  if (parts.length <= 3) return text;
  return `${trimPunctuation(parts[0]!)} … ${trimPunctuation(parts[parts.length - 1]!)}`;
}

function renderReading(
  reading: Reading,
  base: Reading | undefined,
  conventions: ApparatusConventions,
  siglaOrder: string[],
  whole = false,
): ApparatusVariant {
  const sigla = sortSigla(printedSigla(reading), siglaOrder);
  const variant: ApparatusVariant = {
    text: trimPunctuation(reading.text),
    sigla,
    lacunose: reading.lacunose,
  };
  if (reading.lacunose && reading.text === '') variant.note = word(whole ? 'deest' : 'lac', conventions.latin);
  else if (reading.omission) variant.note = word('om', conventions.latin);
  else if (base && base.text === '') variant.note = word('add', conventions.latin);
  return variant;
}

function renderAttachment(attachment: Attachment, conventions: ApparatusConventions): ApparatusVariant {
  const latin = conventions.latin;
  const variant: ApparatusVariant = {
    text: attachment.text,
    sigla: [attachment.name + (attachment.source ? ` ${attachment.source}` : '')],
    lacunose: false,
    attachment,
  };
  if (attachment.kind === 'conjecture') {
    switch (attachment.conjectureKind) {
      case 'deletion':
        variant.note = word('del', latin);
        break;
      case 'lacuna':
        variant.note = latin ? 'lacunam statuit' : 'posits a lacuna';
        break;
      case 'supplement':
        variant.note = word('suppl', latin);
        break;
      case 'transposition':
        variant.note = word('transp', latin);
        break;
      default:
        variant.note = attachment.text === '' ? word('del', latin) : word('coni', latin);
    }
  }
  return variant;
}

/**
 * The texts of a reading that the apparatus names. A witness collated also
 * in a second state (its text before correction, "<id>:original", or the
 * variants it notes, "<id>:variant") is named once where both states agree:
 * "A", not "A A v.l.".
 */
export function printedTextIds(reading: Pick<Reading, 'textIds'>): string[] {
  const present = new Set(reading.textIds);
  return reading.textIds.filter((id) => {
    const state = /^(.*):(original|variant)$/u.exec(id);
    return !(state && present.has(state[1]!));
  });
}

/** The sigla of a reading as the apparatus prints them, in the reading's order. */
export function printedSigla(reading: Pick<Reading, 'textIds' | 'sigla'>): string[] {
  const kept = new Set(printedTextIds(reading));
  return reading.sigla.filter((_, i) => kept.has(reading.textIds[i]!));
}

function sortSigla(sigla: string[], order: string[]): string[] {
  if (order.length === 0) return sigla;
  const rank = new Map(order.map((s, i) => [s, i]));
  return [...sigla].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a.localeCompare(b));
}

/** One entry as a line of text, in the classic form "lemma sigla : reading sigla". */
export function formatEntry(entry: ApparatusEntry, conventions: ApparatusConventions = DEFAULT_CONVENTIONS): string {
  const parts: string[] = [];
  const lemma = entry.lemma === '' ? (conventions.latin ? '' : '') : entry.lemma;
  const lemmaSource = entry.adopted
    ? `${entry.adopted.name}${entry.adopted.source ? ` ${entry.adopted.source}` : ''}`
    : conventions.form === 'positive'
      ? entry.lemmaSigla.join(' ')
      : '';
  parts.push([lemma, lemmaSource].filter((p) => p !== '').join(' ').trim());
  for (const variant of entry.variants) {
    const sigla = variant.sigla.join(' ');
    const text = variant.note
      ? variant.text
        ? `${variant.text} ${variant.note}`
        : variant.note
      : variant.text;
    const printed = variant.attachment && variant.attachment.kind === 'conjecture' && variant.attachment.conjectureKind !== 'deletion' && variant.text
      ? `${variant.text} ${sigla}${variant.note && variant.attachment.conjectureKind && variant.attachment.conjectureKind !== 'substitution' ? ` (${variant.note})` : variant.note === words.coni.latin || variant.note === words.coni.english ? ` (${variant.note})` : ''}`
      : `${text} ${sigla}`;
    parts.push(printed.trim());
  }
  return `${entry.label} ${parts.join(' : ')}`.trim();
}

/** The whole apparatus of a segment as lines. */
export function formatApparatus(entries: ApparatusEntry[], conventions: ApparatusConventions = DEFAULT_CONVENTIONS): string[] {
  return entries.map((e) => formatEntry(e, conventions));
}

/** Which texts agree with the base at a site, for "which witnesses have the critical text". */
export function agreeingSigla(site: Site): string[] {
  const base = site.readings.find((r) => r.base);
  return base ? base.sigla.slice(1) : [];
}
