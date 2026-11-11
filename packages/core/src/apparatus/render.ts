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
  /**
   * Sigla that stand for several witnesses together (a family, or "p" for
   * the agreement of two manuscripts): printed in place of the members'
   * sigla wherever all of them have a reading.
   */
  groups?: SiglumGroup[];
  /**
   * The word for "the other witnesses" ("cett.", "rell."): printed in place
   * of the sigla of the most widely attested reading of an entry, when it
   * has three sigla or more to print. Where that reading is not the lemma's,
   * the lemma's witnesses are named, in a negative apparatus too. Empty or
   * absent: every witness is named.
   */
  rest?: string;
  /**
   * The word for "all the witnesses" ("codd."): printed where the lemma is
   * in no witness and all of them have one reading against it. Empty or
   * absent: they are named.
   */
  all?: string;
}

export interface SiglumGroup {
  siglum: string;
  /** The sigla of the witnesses it stands for. */
  members: string[];
}

export type InterpretativePlacement = 'apparatus' | 'separate' | 'none';

export const DEFAULT_CONVENTIONS: ApparatusConventions = {
  form: 'positive',
  latin: true,
  interpretative: 'separate',
};

/** A conjecture or reported reading attached to a site for printing. */
/** The name a conjecture is given that names no proposer: it is the edition's own. */
export const EDITION_ITSELF = 'this edition';

/** "(Allen's apparatus (1931))" as it is quoted: the source of a record without the brackets round the whole. */
export function unbracketed(source: string | undefined): string {
  const value = (source ?? '').trim();
  const inner = /^\((.*)\)$/s.exec(value)?.[1];
  if (inner === undefined) return value;
  // Only brackets that enclose the whole: "(a) and (b)" keeps its own.
  let depth = 0;
  for (const char of inner) {
    if (char === '(') depth++;
    else if (char === ')' && --depth < 0) return value;
  }
  return depth === 0 ? inner.trim() : value;
}

export interface Attachment {
  kind: 'conjecture' | 'reported';
  /** The reading proposed or reported; empty for a deletion or a lacuna. */
  text: string;
  /** Proposer of a conjecture (`EDITION_ITSELF` where it names none), or the siglum of the witness a reading is reported for. */
  name: string;
  /** The kind of conjecture, when one. */
  conjectureKind?:
    | 'substitution'
    | 'deletion'
    | 'addition'
    | 'lacuna'
    | 'supplement'
    | 'transposition';
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
  /** The sigla printed for the witnesses agreeing with the lemma, base excluded, as the conventions name them. */
  lemmaSigla: string[];
  /** The lemma's witnesses are named whatever the form, since a reading here is given to "the others". */
  lemmaNamed?: boolean;
  /** Each printed alternative, in order. */
  variants: ApparatusVariant[];
  /** A conjecture the edition adopted here, printed as the lemma's source. */
  adopted?: Attachment;
  /** Sources reported to have the lemma's reading, printed after its witnesses. */
  support?: Attachment[];
  /** A transposition statement, when the site is one half. */
  transposition?: string;
  /** Textual, or interpretative: everything printed here has the lemma's letters. */
  kind: SiteKind;
}

export interface ApparatusVariant {
  text: string;
  sigla: string[];
  /** Printed in place of text, or after it: for a reading without words, an addition, a conjecture. */
  note?: string;
  attachment?: Attachment;
  /** Sources reported to have this reading too, printed after its witnesses. */
  reported?: Attachment[];
}

const words = {
  om: { latin: 'om.', english: 'omitted' },
  add: { latin: 'add.', english: 'added' },
  del: { latin: 'del.', english: 'deleted' },
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
  const entries: { entry: ApparatusEntry; site: Site }[] = [];
  // The witnesses proper that have the segment: those given and not absent, and those in some place's reading.
  const absent = new Set(collation.absent ?? []);
  const everyone = [
    ...new Set([
      ...Object.keys(collation.sigla ?? {}).filter((id) => !absent.has(id)),
      ...collation.sites.flatMap((site) => site.readings.flatMap((r) => r.textIds)),
    ]),
  ].filter((id) => id !== collation.baseId && !isState(id));
  for (const site of collation.sites) {
    // A printed edition leaves out what the editor judges minor.
    if (site.minor) continue;
    const base = site.readings.find((r) => r.base);
    const others = site.readings.filter((r) => !r.base);
    const attached = attachments[site.index] ?? [];
    if (others.length === 0 && attached.length === 0) continue;
    const kind = printedKind(site, attached);
    if (kind === 'interpretative' && conventions.interpretative === 'none') continue;
    // What the edition prints is a conjecture's reading, or has the support of a source that is only reported.
    const adopted = attached.find((a) => a.adopted && a.kind === 'conjecture');
    const support = attached.filter((a) => a.adopted && a.kind === 'reported');
    const variants: ApparatusVariant[] = others.map((reading) =>
      renderReading(reading, base, conventions, siglaOrder),
    );
    // The edition's own siglum comes first and is not printed.
    const named = nameWitnesses(
      {
        sigla: base ? sortSigla(printedSigla(base).slice(1), siglaOrder) : [],
        main: base ? mainWitnesses(base, collation.baseId) : 0,
      },
      variants.map((variant, k) => ({
        sigla: variant.sigla,
        main: mainWitnesses(others[k]!, collation.baseId),
        states: stateSigla(others[k]!, siglaOrder),
      })),
      // Where a witness stands at a wider place around this one, or is not there, "the others" and "all" would wrongly take it in.
      everyone.some((id) => !site.readings.some((r) => r.textIds.includes(id)))
        ? { ...conventions, rest: '', all: '' }
        : conventions,
    );
    variants.forEach((variant, k) => (variant.sigla = named.variants[k]!));
    for (const attachment of attached) {
      if (attachment.adopted) continue;
      // A source reported to read what a witness reads stands with that witness.
      const same =
        attachment.kind === 'reported'
          ? variants.find(
              (v) =>
                v.attachment?.kind !== 'conjecture' &&
                sameWords(v.text, attachment.text) &&
                (v.text !== '' || v.note === word('om', conventions.latin)),
            )
          : undefined;
      if (same) (same.reported ??= []).push(attachment);
      else variants.push(renderAttachment(attachment, conventions));
    }
    const entry: ApparatusEntry = {
      siteIndex: site.index,
      label,
      // A long lemma against which the witnesses have nothing is abridged.
      lemma: base
        ? lemmaOf(
            base,
            others.every((r) => r.text === ''),
          )
        : '',
      lemmaSigla: named.lemma,
      variants,
      kind,
    };
    if (named.lemmaNamed || (support.length > 0 && named.lemma.length > 0)) entry.lemmaNamed = true;
    if (adopted) entry.adopted = adopted;
    if (support.length > 0) entry.support = support;
    if (
      site.transposition &&
      (site.transposition.inPassage !== undefined || site.transposition.withSite !== site.index)
    ) {
      entry.transposition =
        `${word('transp', conventions.latin)} ${site.transposition.textIds.length} `.trim();
    }
    entries.push({ entry, site });
  }
  // In the order of the text: what is added before a word, then the word; a wide place before the places within it.
  return entries
    .sort(
      (a, b) =>
        a.site.baseFrom - b.site.baseFrom ||
        Number(a.site.baseTo > a.site.baseFrom) - Number(b.site.baseTo > b.site.baseFrom) ||
        b.site.baseTo - a.site.baseTo ||
        a.site.index - b.site.index,
    )
    .map((e) => e.entry);
}

/** A second state of a witness (its text before correction, a later hand's, the variants it notes) collated as a text of its own. */
function isState(textId: string): boolean {
  return /:(original|variant|s\d+)$/u.test(textId);
}

/** How many witnesses proper have a reading: the base and the further states of witnesses left out. */
function mainWitnesses(reading: Pick<Reading, 'textIds'>, baseId: string): number {
  return printedTextIds(reading).filter((id) => id !== baseId && !isState(id)).length;
}

/** The sigla of the states among a reading's texts. */
function stateSigla(reading: Pick<Reading, 'textIds' | 'sigla'>, order: string[]): string[] {
  const kept = new Set(printedTextIds(reading).filter(isState));
  return sortSigla(
    reading.sigla.filter((_, i) => kept.has(reading.textIds[i]!)),
    order,
  );
}

/** The sigla with each group's members replaced by the group's siglum, where all of them are there. */
export function groupSigla(sigla: string[], groups: SiglumGroup[] | undefined): string[] {
  if (!groups || groups.length === 0) return sigla;
  let out = [...sigla];
  for (const group of [...groups].sort((a, b) => b.members.length - a.members.length)) {
    if (group.members.length < 2 || !group.members.every((m) => out.includes(m))) continue;
    const at = Math.min(...group.members.map((m) => out.indexOf(m)));
    out = out.flatMap((s, i) => (i === at ? [group.siglum] : group.members.includes(s) ? [] : [s]));
  }
  return out;
}

interface NamedReading {
  sigla: string[];
  /** Witnesses proper among them. */
  main: number;
  /** The sigla among them that are further states of witnesses. */
  states?: string[];
}

/**
 * The sigla as the conventions print them: families by their siglum, all
 * the witnesses by one word where they stand together against a lemma none
 * of them has, the witnesses of the most widely attested reading by "the
 * others".
 */
function nameWitnesses(
  lemma: NamedReading,
  variants: NamedReading[],
  conventions: ApparatusConventions,
): { lemma: string[]; variants: string[][]; lemmaNamed: boolean } {
  const grouped = (r: NamedReading) => groupSigla(r.sigla, conventions.groups);
  const out = { lemma: grouped(lemma), variants: variants.map(grouped), lemmaNamed: false };
  const attested = variants.map((v, k) => ({ v, k })).filter((x) => x.v.main > 0);
  if (conventions.all && lemma.main === 0 && attested.length === 1 && attested[0]!.v.main >= 2) {
    const { v, k } = attested[0]!;
    out.variants[k] = [conventions.all, ...(v.states ?? [])];
    return out;
  }
  if (!conventions.rest) return out;
  const readings = [lemma, ...variants];
  const most = Math.max(...readings.map((r) => r.main));
  const widest = readings.filter((r) => r.main === most);
  if (widest.length !== 1 || readings.filter((r) => r.main > 0).length < 2) return out;
  const index = readings.indexOf(widest[0]!);
  const printed = index === 0 ? out.lemma : out.variants[index - 1]!;
  if (printed.length < 3) return out;
  if (index === 0) out.lemma = [conventions.rest];
  else {
    out.variants[index - 1] = [conventions.rest, ...(variants[index - 1]!.states ?? [])];
    out.lemmaNamed = lemma.sigla.length > 0;
  }
  return out;
}

/**
 * An entry is interpretative when its site is and every conjecture or
 * reported reading there has the lemma's letters too: a conjecture of other
 * words makes it textual, whatever the witnesses have.
 */
export function printedKind(site: Site, attached: readonly Pick<Attachment, 'text'>[]): SiteKind {
  if (site.kind === 'textual') return 'textual';
  if (attached.length === 0) return 'interpretative';
  const letters = archetypeLetters(site.readings.find((r) => r.base)?.text ?? '');
  return attached.every((a) => a.text !== '' && archetypeLetters(a.text) === letters)
    ? 'interpretative'
    : 'textual';
}

/**
 * The entries as printed: the textual ones, and the interpretative ones
 * among them or in a list of their own, as the conventions say.
 */
export function splitEntries(
  entries: ApparatusEntry[],
  conventions: Pick<ApparatusConventions, 'interpretative'>,
): { main: ApparatusEntry[]; interpretative: ApparatusEntry[] } {
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
 * The lemma: the base's words; where it has more than three and nothing is
 * read against it (the witnesses of the place have none of the words, or
 * only conjectures concern it), its first and last words with an ellipsis
 * between.
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
): ApparatusVariant {
  const sigla = sortSigla(printedSigla(reading), siglaOrder);
  const variant: ApparatusVariant = { text: trimPunctuation(reading.text), sigla };
  if (reading.omission) variant.note = word('om', conventions.latin);
  else if (base && base.text === '') variant.note = word('add', conventions.latin);
  return variant;
}

function renderAttachment(
  attachment: Attachment,
  conventions: ApparatusConventions,
): ApparatusVariant {
  const latin = conventions.latin;
  const variant: ApparatusVariant = {
    text: attachment.text,
    sigla: [attachment.name + (attachment.source ? ` ${attachment.source}` : '')],
    attachment,
  };
  // A source reported to have nothing here leaves the words out.
  if (attachment.kind === 'reported' && attachment.text === '') variant.note = word('om', latin);
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
  return [...sigla].sort(
    (a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a.localeCompare(b),
  );
}

function sameWords(a: string, b: string): boolean {
  return trimPunctuation(a).normalize('NFC') === trimPunctuation(b).normalize('NFC');
}

/** A proposer or a source as printed: the name, and where it is found. */
export function attachmentName(attachment: Pick<Attachment, 'name' | 'source'>): string {
  return `${attachment.name}${attachment.source ? ` ${attachment.source}` : ''}`;
}

/**
 * What an adopted conjecture did, printed before its proposer where it is
 * not plain from the reading: "suppl. Meineke", "lacunam statuit Hermann".
 */
export function adoptedNote(
  adopted: Pick<Attachment, 'conjectureKind'>,
  conventions: Pick<ApparatusConventions, 'latin'>,
): string {
  switch (adopted.conjectureKind) {
    case 'supplement':
      return word('suppl', conventions.latin);
    case 'lacuna':
      return conventions.latin ? 'lacunam statuit' : 'posits a lacuna';
    case 'deletion':
      return word('del', conventions.latin);
    case 'transposition':
      return word('transp', conventions.latin);
    default:
      return '';
  }
}

/** One entry as a line of text, in the classic form "lemma sigla : reading sigla". */
export function formatEntry(
  entry: ApparatusEntry,
  conventions: ApparatusConventions = DEFAULT_CONVENTIONS,
): string {
  const parts: string[] = [];
  const witnesses = entry.adopted
    ? [adoptedNote(entry.adopted, conventions), attachmentName(entry.adopted)]
        .filter((p) => p !== '')
        .join(' ')
    : conventions.form === 'positive' || entry.lemmaNamed
      ? entry.lemmaSigla.join(' ')
      : '';
  const lemmaSource = [witnesses, ...(entry.support ?? []).map(attachmentName)]
    .filter((p) => p !== '')
    .join(', ');
  parts.push(
    [entry.lemma, lemmaSource]
      .filter((p) => p !== '')
      .join(' ')
      .trim(),
  );
  for (const variant of entry.variants) {
    const sigla = [variant.sigla.join(' '), ...(variant.reported ?? []).map(attachmentName)]
      .filter((p) => p !== '')
      .join(', ');
    const text = variant.note
      ? variant.text
        ? `${variant.text} ${variant.note}`
        : variant.note
      : variant.text;
    const printed =
      variant.attachment &&
      variant.attachment.kind === 'conjecture' &&
      variant.attachment.conjectureKind !== 'deletion' &&
      variant.text
        ? `${variant.text} ${sigla}${variant.note && variant.attachment.conjectureKind && variant.attachment.conjectureKind !== 'substitution' ? ` (${variant.note})` : variant.note === words.coni.latin || variant.note === words.coni.english ? ` (${variant.note})` : ''}`
        : `${text} ${sigla}`;
    parts.push(printed.trim());
  }
  return `${entry.label} ${parts.join(' : ')}`.trim();
}

/** The whole apparatus of a segment as lines. */
export function formatApparatus(
  entries: ApparatusEntry[],
  conventions: ApparatusConventions = DEFAULT_CONVENTIONS,
): string[] {
  return entries.map((e) => formatEntry(e, conventions));
}

/** Which texts agree with the base at a site, for "which witnesses have the critical text". */
export function agreeingSigla(site: Site): string[] {
  const base = site.readings.find((r) => r.base);
  return base ? base.sigla.slice(1) : [];
}
