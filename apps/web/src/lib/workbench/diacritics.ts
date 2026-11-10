/**
 * Tools for the diacritics and the case of a transcription's words, each run
 * only when asked: removing one kind of mark from the diplomatic text; making
 * words lower or upper case; and normalizing the diacritics of the
 * normalized text from the analyser's forms. Pure; the
 * workbench runs the operations and keeps the words left to choose.
 */
import {
  collate,
  greekLower,
  isAllCaps,
  isToken,
  looseKey,
  type Id,
  type Op,
  type Stream,
  type Token,
  type Unit,
} from '@varians/core';

// Marks, as Unicode combining characters after canonical decomposition.
const GRAVE = '̀';
const ACUTE = '́';
const CIRCUMFLEX = '͂';
const SMOOTH = '̓';
const ROUGH = '̔';
const DIAERESIS = '̈';
const IOTA_SUBSCRIPT = 'ͅ';
/** The grave and acute written as Greek tonos marks, which canonical decomposition leaves as they are. */
const LEGACY = { '̀': GRAVE, '́': ACUTE } as Record<string, string>;

export type MarkKind = 'accents' | 'breathings' | 'diaereses' | 'iotaSubscripts';

const MARKS_OF: Record<MarkKind, string[]> = {
  accents: [GRAVE, ACUTE, CIRCUMFLEX],
  breathings: [SMOOTH, ROUGH],
  diaereses: [DIAERESIS],
  iotaSubscripts: [IOTA_SUBSCRIPT],
};

function decompose(text: string): string {
  return [...text.normalize('NFD')].map((c) => LEGACY[c] ?? c).join('');
}

/** A word without the marks of the kinds given. */
export function withoutMarks(text: string, kinds: MarkKind[]): string {
  const drop = new Set(kinds.flatMap((k) => MARKS_OF[k]));
  return [...decompose(text)]
    .filter((c) => !drop.has(c))
    .join('')
    .normalize('NFC');
}

/** Which of a token's two forms an operation changes: the diplomatic form, or the normalized one. */
export type FormField = 'form' | 'norm';

function tokensOf(stream: Stream, ids: Iterable<Id>): Token[] {
  const wanted = new Set(ids);
  return stream.items.filter((i): i is Token => isToken(i) && wanted.has(i.id));
}

/** The text of a token in a field: its normalized form, which is the diplomatic one where it has none of its own. */
export function textOf(token: Token, field: FormField): string {
  return field === 'norm' ? (token.norm ?? token.form) : token.form;
}

function setOp(token: Token, field: FormField, value: string): Op {
  // Setting the normalized form is the editor's decision: it is checked.
  if (field === 'norm')
    return {
      t: 'set',
      id: token.id,
      fields: { norm: value === token.form ? null : value, unchecked: null },
    };
  return { t: 'set', id: token.id, fields: { form: value } };
}

/** Operations removing marks of the kinds given from the words' text in a field. */
export function removeMarksOps(
  stream: Stream,
  ids: Iterable<Id>,
  field: FormField,
  kinds: MarkKind[],
): Op[] {
  const ops: Op[] = [];
  for (const token of tokensOf(stream, ids)) {
    const before = textOf(token, field);
    const after = withoutMarks(before, kinds);
    if (after !== before) ops.push(setOp(token, field, after));
  }
  return ops;
}

/** Operations making the words' text in a field lower case (with a final sigma) or upper case. */
export function caseOps(
  stream: Stream,
  ids: Iterable<Id>,
  field: FormField,
  to: 'lower' | 'upper',
): Op[] {
  const ops: Op[] = [];
  for (const token of tokensOf(stream, ids)) {
    const before = textOf(token, field);
    const after = to === 'lower' ? greekLower(before) : before.toUpperCase();
    if (after !== before) ops.push(setOp(token, field, after));
  }
  return ops;
}

// Normalizing diacritics

/** One form a word's letters can be, with what the analyser says of it. */
export interface FormOption {
  /** The form as the word stands here: accented for its place (a grave before another word). */
  form: string;
  /** The words it can be: each lemma with its analyses spelt out. */
  readings: { lemma: string; descriptions: string[] }[];
}

export interface AnalysisLike {
  form: string;
  lemma: string;
  description: string;
}

/** What normalizing a word came to: a form set, a choice left to the editor, or nothing known. */
export type NormalizeOutcome =
  | { kind: 'set'; value: string }
  | { kind: 'kept' }
  | { kind: 'choose'; options: FormOption[]; reason: 'several' | 'disagrees' }
  | { kind: 'unknown' };

/** The punctuation around a word's letters, kept as it stands: an elision mark is punctuation here. */
function split(text: string): { before: string; core: string; after: string } {
  // The modifier apostrophe (ʼ) is a letter to Unicode, and an elision mark here.
  const m = /^((?:[^\p{L}]|\u02bc)*)(.*?)((?:[^\p{L}\p{M}]|\u02bc)*)$/su.exec(
    text.normalize('NFC'),
  );
  return { before: m?.[1] ?? '', core: m?.[2] ?? text, after: m?.[3] ?? '' };
}

/** A form with its graves read as acutes: the form as a dictionary writes it. */
function asLexical(form: string): string {
  return split(decompose(form).replace(/̀/gu, ACUTE).normalize('NFC')).core;
}

/** The letters of a word with the accent and breathing marks on each, Greek letters only. */
function lettersWithMarks(text: string): { letter: string; marks: string }[] | null {
  const out: { letter: string; marks: string }[] = [];
  for (const c of decompose(text.toLowerCase())) {
    if ((c >= 'α' && c <= 'ω') || c === 'ϝ') out.push({ letter: c, marks: '' });
    else if ([GRAVE, ACUTE, CIRCUMFLEX, SMOOTH, ROUGH].includes(c) && out.length) {
      const mark = c === GRAVE ? ACUTE : c;
      out[out.length - 1]!.marks += mark;
    }
  }
  return out;
}

/** Whether a word carries any accent or breathing. */
export function hasAccentOrBreathing(text: string): boolean {
  return /[̀́͂̓̔̀́]/u.test(text.normalize('NFD'));
}

/** Whether a form agrees with the accents and breathings the witness writes, wherever it writes them. */
function agreesWith(form: string, written: string): boolean {
  const a = lettersWithMarks(form);
  const b = lettersWithMarks(written);
  if (!a || !b || a.length !== b.length) return true;
  return b.every(
    (w, i) => w.marks === '' || [...w.marks].sort().join('') === [...a[i]!.marks].sort().join(''),
  );
}

/** An elision mark at the end of a word, or at its start (prodelision). */
const ELISION = /[ʼ’᾽'\u02bc][^\p{L}]*$|^[^\p{L}]*[ʼ’᾽'\u02bc]/u;

/** A breathing on a letter within the word, as in crasis (κἀγώ): not on the first vowel, nor on the second of an opening diphthong. */
function breathingWithin(form: string): boolean {
  const letters = lettersWithMarks(form) ?? [];
  const diphthong = /^(αι|ει|οι|υι|αυ|ευ|ηυ|ου)/u.test(
    letters
      .slice(0, 2)
      .map((l) => l.letter)
      .join(''),
  );
  return letters.some((l, i) => i > (diphthong ? 1 : 0) && /[\u0313\u0314]/u.test(l.marks));
}

/** Words that lean on the word before and take its accent: before them an acute stays acute. */
const ENCLITICS = new Set(
  'τις τι του τω τινος τινι τινα τινες τινων τισι τισιν τινας τε γε περ τοι νυν πως που ποθι ποτε πω πη μοι μου με σοι σου σε οι ου ε μιν νιν σφι σφιν σφισι σφισιν εστι εστιν εσμεν εστε εισι εισιν εστον φημι φησι φησιν φαμεν φατε φασι φασιν'.split(
    ' ',
  ),
);
/** Words whose acute never turns grave. */
const ALWAYS_ACUTE = new Set(['τίς', 'τί']);

/** A lexical form as it stands before what follows: a final acute becomes a grave before another word. */
export function inPlace(
  lexical: string,
  next: { text: string } | null,
  punctuationAfter: boolean,
): string {
  if (!next || punctuationAfter || ALWAYS_ACUTE.has(lexical)) return lexical;
  const nextCore = split(next.text).core;
  if (ENCLITICS.has(looseKey(nextCore)) && !hasAccentOrBreathing(nextCore)) return lexical;
  const chars = [...decompose(lexical)];
  const at = chars.lastIndexOf(ACUTE);
  if (at < 0) return lexical;
  // Only an acute on the last syllable: no vowel after it.
  const vowels = /[αεηιουω]/u;
  if (chars.slice(at + 1).some((c) => vowels.test(c))) return lexical;
  chars[at] = GRAVE;
  return chars.join('').normalize('NFC');
}

export interface NormalizeInput {
  /** The word's text to normalize (its normalized form, or its only form). */
  current: string;
  /** The word as the witness writes it, when the transcription keeps it: its accents and breathings choose among the options. */
  diplomatic: string | null;
  /** The analyses of its letters. */
  analyses: AnalysisLike[];
  /** The normalized form chosen before for the same diplomatic form, if any. */
  remembered: string | null;
  /** The next word, for the accent of this one in its place. */
  next: { text: string } | null;
}

/**
 * Normalize one word's diacritics. Options are the analyser's forms of its
 * letters; where the witness writes accents or breathings, only the forms
 * that agree with them; a form chosen before comes first. One option left
 * is set; a word already written as one of the options is kept; several
 * are left to choose, as are words the witness writes otherwise than every
 * option (then all are offered).
 */
export function normalizeWord(input: NormalizeInput): NormalizeOutcome {
  const { before, core, after } = split(input.current);
  if (!core) return { kind: 'kept' };
  // One option for each form: the choice is of a form, whatever words it can be.
  // An elided form only for a word written elided, and the other way round.
  const elided = ELISION.test(input.current);
  const byForm = new Map<string, FormOption>();
  for (const a of input.analyses) {
    const lexical = asLexical(a.form);
    if (!lexical || looseKey(lexical) !== looseKey(core)) continue;
    if (ELISION.test(a.form) !== elided) continue;
    if (!a.lemma || /^\?+$/u.test(a.lemma)) continue;
    const option = byForm.get(lexical) ?? { form: lexical, readings: [] };
    let reading = option.readings.find((r) => r.lemma === a.lemma);
    if (!reading) option.readings.push((reading = { lemma: a.lemma, descriptions: [] }));
    if (a.description && !reading.descriptions.includes(a.description))
      reading.descriptions.push(a.description);
    byForm.set(lexical, option);
  }
  let options = [...byForm.values()];
  // Crasis (a breathing within the word) only where nothing else fits.
  const plain = options.filter((o) => !breathingWithin(o.form));
  if (plain.length) options = plain;
  if (options.length === 0) return { kind: 'unknown' };

  const punctuationAfter = /[.,;·:!?;]/u.test(after);
  const place = (lexical: string) => {
    let value = inPlace(lexical, input.next, punctuationAfter);
    // Case is the editor's: a word written with an initial capital keeps it (a word all in capitals is not a name).
    if (/^\p{Lu}/u.test(core) && !isAllCaps(core) && !/^\p{Lu}/u.test(value))
      value = value.charAt(0).toUpperCase() + value.slice(1);
    return `${before}${value}${after}`;
  };
  const distinctForms = () => [...new Set(options.map((o) => o.form))];

  // Already one of the options, as written: nothing to do.
  if (hasAccentOrBreathing(core) && options.some((o) => o.form === asLexical(core)))
    return { kind: 'kept' };

  if (input.diplomatic && hasAccentOrBreathing(input.diplomatic)) {
    const agreeing = options.filter((o) => agreesWith(o.form, split(input.diplomatic!).core));
    if (agreeing.length === 0)
      return {
        kind: 'choose',
        options: options.map((o) => ({ ...o, form: place(o.form) })),
        reason: 'disagrees',
      };
    options = agreeing;
  }
  if (input.remembered) {
    const remembered = asLexical(input.remembered);
    if (options.some((o) => o.form === remembered))
      return { kind: 'set', value: place(remembered) };
  }
  const forms = distinctForms();
  if (forms.length === 1) {
    const value = place(forms[0]!);
    return value === input.current ? { kind: 'kept' } : { kind: 'set', value };
  }
  return {
    kind: 'choose',
    options: options.map((o) => ({ ...o, form: place(o.form) })),
    reason: 'several',
  };
}

/** The word after a token in reading order, for its accent; null at the end of the text. */
export function nextWord(stream: Stream, id: Id, field: FormField): { text: string } | null {
  const at = stream.items.findIndex((i) => i.id === id);
  for (let i = at + 1; i < stream.items.length; i++) {
    const item = stream.items[i]!;
    if (isToken(item)) return { text: textOf(item, field) };
    if (item.kind === 'object' && item.type === 'gap') return null;
  }
  return null;
}

/** The operation setting a word's normalized text in a field. */
export function setTextOp(token: Token, field: FormField, value: string): Op {
  return setOp(token, field, value);
}

// Taking normalized forms from another text

export interface TakenForms {
  ops: Op[];
  /** Words given the other text's form. */
  taken: number;
  /** Words standing against a word of other letters: textual variants, left alone. */
  differing: number;
}

/**
 * The normalized forms of another text (a transcription or an edition of the
 * same work), taken where a word's letters agree with the word it stands
 * against: the passages are aligned segment by segment, as collation aligns
 * them. A word against other letters is left alone, and so is one whose
 * diplomatic accents or breathings disagree with the other form. The form
 * is accented for its place here.
 */
export function takeForms(
  stream: Stream,
  scope: Iterable<Id>,
  field: FormField,
  keepsDiplomatic: boolean,
  hereUnits: Record<string, Unit[]>,
  thereUnits: Record<string, Unit[]>,
): TakenForms {
  const wanted = new Set(scope);
  const byId = new Map(stream.items.filter(isToken).map((t) => [t.id, t] as const));
  const ops: Op[] = [];
  let taken = 0;
  let differing = 0;
  for (const [segmentId, here] of Object.entries(hereUnits)) {
    const there = thereUnits[segmentId];
    if (!there?.length || !here.length) continue;
    const collation = collate({ id: 'here', siglum: 'here', units: here }, [
      { id: 'there', siglum: 'there', units: there },
    ]);
    // A token read as several words is left alone: its words are not one form.
    const unitsOf = new Map<Id, number>();
    for (const u of here) for (const id of u.tokenIds) unitsOf.set(id, (unitsOf.get(id) ?? 0) + 1);
    for (const column of collation.columns) {
      const h = column.cells.get('here');
      const t = column.cells.get('there');
      if (!h || !t || h.unitIndex < 0 || t.unitIndex < 0) continue;
      const hu = here[h.unitIndex]!;
      const tu = there[t.unitIndex]!;
      if (hu.gap || tu.gap || hu.tokenIds.length !== 1) continue;
      const token = byId.get(hu.tokenIds[0]!);
      if (!token || !wanted.has(token.id) || unitsOf.get(token.id) !== 1) continue;
      if (looseKey(hu.text) !== looseKey(tu.text)) {
        differing++;
        continue;
      }
      const outcome = normalizeWord({
        current: textOf(token, field),
        diplomatic: keepsDiplomatic ? token.form : null,
        analyses: [{ form: tu.text, lemma: '-', description: '' }],
        remembered: null,
        next: nextWord(stream, token.id, field),
      });
      if (outcome.kind === 'set') {
        ops.push(setOp(token, field, outcome.value));
        taken++;
      }
    }
  }
  return { ops, taken, differing };
}
