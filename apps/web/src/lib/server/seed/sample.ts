/**
 * Sample data: the opening of Iliad 1 in three witnesses that differ in the
 * ways an apparatus exists to report, with an edition based on A, a
 * conjecture and a reported reading; and the start of Plato's Apology on
 * Stephanus pages. Built through the same services the application uses.
 */

import {
  SCHEME_PRESETS,
  deriveEdition,
  fromText,
  newId,
  stripDiacritics,
  type Item,
  type Stream,
  type Token,
} from '@varians/core';
import {
  alignmentConstraints,
  bibliographyItems,
  conjectures,
  editionCollaborators,
  editionSigla,
  editions,
  pages,
  referenceSchemes,
  reportedReadings,
  transcriptions,
  witnesses,
  workMaintainers,
  works,
  witnessMaintainers,
  type Database,
} from '@varians/db';
import { eq } from 'drizzle-orm';
import { setCitations } from '../bibliography.ts';
import { reviewSite } from '../conjectures.ts';
import { setSiteKind } from '../collation.ts';
import { nameMoment, replaceContent } from '../documents/service.ts';
import { setReviewFrom } from '../history.ts';
import { publishTranscription } from '../publish.ts';
import { addNote } from '../notes.ts';
import { createZones } from '../zones.ts';
import { resolveLabels, schemeOfWork } from '../segments.ts';

export const DEFAULT_CONVENTIONS = {
  apparatus: 'positive' as const,
  lineation: 'verse' as const,
  numberEvery: 5,
  speakerDisplay: 'margin' as const,
  sigla: {
    supplied: ['⟨', '⟩'] as [string, string],
    deleted: ['[', ']'] as [string, string],
    lacuna: '***',
    crux: '†',
  },
};

const ILIAD: Record<string, string> = {
  '1.1': 'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος',
  '1.2': 'οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,',
  '1.3': 'πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν',
  '1.4': 'ἡρώων, αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν',
  '1.5': 'οἰωνοῖσί τε πᾶσι, Διὸς δ᾽ ἐτελείετο βουλή,',
  '1.6': 'ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε',
  '1.7': 'Ἀτρεΐδης τε ἄναξ ἀνδρῶν καὶ δῖος Ἀχιλλεύς.',
  '1.8': 'τίς τ᾽ ἄρ σφωε θεῶν ἔριδι ξυνέηκε μάχεσθαι;',
  '1.9': 'Λητοῦς καὶ Διὸς υἱός· ὁ γὰρ βασιλῆϊ χολωθεὶς',
  '1.10': 'νοῦσον ἀνὰ στρατὸν ὄρσε κακήν, ὀλέκοντο δὲ λαοί,',
};

/** Lines to a stream, each line a segment, with optional page breaks before given labels. */
function linesToStream(
  lines: Record<string, string>,
  segmentIdOf: (label: string) => string,
  pageBefore: Record<string, string> = {},
): Stream {
  const items: Item[] = [];
  let first = true;
  for (const [label, text] of Object.entries(lines)) {
    if (pageBefore[label])
      items.push({ kind: 'break', id: newId(), type: 'page', pageId: pageBefore[label] });
    else if (!first) items.push({ kind: 'break', id: newId(), type: 'line' });
    first = false;
    // The sample is the Iliad: every word is Ancient Greek.
    const line = fromText(text, { lang: 'grc' });
    (line.items[0] as Token).segment = { segmentId: segmentIdOf(label) };
    items.push(...line.items);
  }
  return { items };
}

export interface SampleResult {
  workId: string;
  editionId: string;
  editionSlug: string;
  witnessIds: Record<string, string>;
}

export interface SampleOptions {
  /** A second account, made a collaborator on the edition. */
  collaboratorId?: string;
}

/** Seed the sample, owned by the given user. Idempotent by work slug. */
export async function seedSample(
  db: Database,
  ownerId: string,
  options: SampleOptions = {},
): Promise<SampleResult> {
  const existing = await db.select({ id: works.id }).from(works).where(eq(works.slug, 'iliad'));
  if (existing.length) {
    const [edition] = await db
      .select({ id: editions.id, slug: editions.slug })
      .from(editions)
      .where(eq(editions.workId, existing[0]!.id));
    return {
      workId: existing[0]!.id,
      editionId: edition?.id ?? '',
      editionSlug: edition?.slug ?? '',
      witnessIds: {},
    };
  }

  const schemeId = newId();
  await db.insert(referenceSchemes).values({
    id: schemeId,
    name: SCHEME_PRESETS[0]!.name,
    levels: SCHEME_PRESETS[0]!.scheme.levels,
    createdBy: ownerId,
  });
  const workId = newId();
  await db.insert(works).values({
    id: workId,
    slug: 'iliad',
    title: 'Iliad',
    author: 'Homer',
    identifier: 'urn:cts:greekLit:tlg0012.tlg001',
    schemeId,
    createdBy: ownerId,
  });
  await db.insert(workMaintainers).values({ workId, userId: ownerId });
  const work = await schemeOfWork(db, workId);
  const labels = Object.keys(ILIAD);
  const segmentMap = await resolveLabels(db, work, labels);
  const segmentIdOf = (label: string) => segmentMap.get(label)!.id;

  // Witness A: Venetus A, with written and read forms and three pages.
  const aId = await witness(db, ownerId, {
    slug: 'venetus-a',
    siglum: 'A',
    name: 'Venetus A',
    repository: 'Biblioteca Nazionale Marciana',
    settlement: 'Venice',
    shelfmark: 'Marc. gr. Z. 454 (= 822)',
    dateText: 's. X',
    material: 'parchment',
    description: 'The principal manuscript of the Iliad, with scholia.',
  });
  const aPages = await makePages(db, aId, ['12r', '12v', '13r']);
  const aRead = linesToStream(ILIAD, segmentIdOf, {
    '1.1': aPages[0]!,
    '1.6': aPages[1]!,
    '1.9': aPages[2]!,
  });
  for (const item of aRead.items) {
    if (item.kind !== 'token') continue;
    const written = stripDiacritics(item.form)
      .toUpperCase()
      .replace(/[,.;·]/gu, '');
    if (written !== item.form) {
      item.norm = item.form;
      item.form = written;
    }
  }
  // A couple of features on A: an unclear word and a supplied one.
  const unclear = aRead.items.filter((i) => i.kind === 'token')[6] as Token;
  unclear.marks = [{ kind: 'unclear' }];
  const supplied = aRead.items.filter((i) => i.kind === 'token')[1] as Token;
  supplied.marks = [{ kind: 'supplied', attrs: { reason: 'lost' } }];
  const aTranscription = await transcription(db, aId, ownerId, 'Iliad 1', aRead, true);

  // Witness B: substitutions, a transposition within a line, a line omitted.
  const bLines = { ...ILIAD };
  bLines['1.2'] = 'οὐλομένην, ἣ μυρία Ἀχαιοῖς ἄλγεα θῆκε,';
  bLines['1.4'] = 'ἡρώων, αὐτοὺς δὲ ἕλωρα τεῦχε κύνεσσιν';
  bLines['1.8'] = 'τίς τ᾽ ἄρ σφωε θεῶν ἔριδι συνέηκε μάχεσθαι;';
  bLines['1.9'] = 'Διὸς καὶ Λητοῦς υἱός· ὁ γὰρ βασιλῆϊ χολωθεὶς';
  delete bLines['1.6'];
  const bId = await witness(db, ownerId, {
    slug: 'venetus-b',
    siglum: 'B',
    name: 'Venetus B',
    repository: 'Biblioteca Nazionale Marciana',
    settlement: 'Venice',
    shelfmark: 'Marc. gr. Z. 453',
    dateText: 's. XI',
  });
  const bTranscription = await transcription(
    db,
    bId,
    ownerId,
    'Iliad 1',
    linesToStream(bLines, segmentIdOf),
    false,
  );

  // Witness C: without lines 3 and 6, a gap inside line 5, one substitution.
  const cLines: Record<string, string> = { ...ILIAD };
  delete cLines['1.3'];
  delete cLines['1.6'];
  cLines['1.10'] = 'νοῦσον ἀνὰ στρατὸν ὄρσε κακά, ὀλέκοντο δὲ λαοί,';
  const cId = await witness(db, ownerId, {
    slug: 'laurentianus-c',
    siglum: 'C',
    name: 'Codex Laurentianus',
    category: 'manuscript',
    dateText: 's. XII',
  });
  const cStream = linesToStream(cLines, segmentIdOf);
  // Replace "Διὸς δ᾽" in 1.5 with a gap.
  const line5Start = cStream.items.findIndex(
    (i) => i.kind === 'token' && i.segment?.segmentId === segmentIdOf('1.5'),
  );
  const dios = cStream.items.findIndex(
    (i, k) => k > line5Start && i.kind === 'token' && i.form === 'Διὸς',
  );
  if (dios > 0)
    cStream.items.splice(dios, 2, {
      kind: 'object',
      id: newId(),
      type: 'gap',
      attrs: { reason: 'lost', quantity: 6, unit: 'character' },
    });
  const cTranscription = await transcription(db, cId, ownerId, 'Iliad 1', cStream, false);

  // The edition, based on A.
  const editionId = newId();
  const content = deriveEdition(aRead, aTranscription, {});
  await db.insert(editions).values({
    id: editionId,
    workId,
    slug: 'iliad-1-working-edition',
    title: 'Iliad 1, a working edition',
    editors: ['Test User'],
    preface:
      'The opening of the Iliad, collated from three witnesses. A worked example, not a verified text.',
    ownerId,
    conventions: DEFAULT_CONVENTIONS,
  });
  await replaceContent(db, 'edition', editionId, ownerId, 0, content, 'based on A');
  await db.insert(editionSigla).values([
    { editionId, witnessId: aId, transcriptionId: aTranscription, siglum: 'A', position: 0 },
    { editionId, witnessId: bId, transcriptionId: bTranscription, siglum: 'B', position: 1 },
    { editionId, witnessId: cId, transcriptionId: cTranscription, siglum: 'C', position: 2 },
  ]);

  // Conjectures: Zenodotus' δαῖτα (ancient, reported by Athenaeus) and one of the editor's own.
  const zenodotus = newId();
  await db.insert(conjectures).values([
    {
      id: zenodotus,
      workId,
      segmentId: segmentIdOf('1.5'),
      kind: 'substitution',
      lemma: 'πᾶσι',
      reading: 'δαῖτα',
      proposer: 'Zenodotus',
      note: 'Reported as the reading of Zenodotus by Athenaeus, Deipnosophistae 1.12e; no surviving manuscript has it.',
      ownerId,
    },
    {
      id: newId(),
      workId,
      segmentId: segmentIdOf('1.4'),
      kind: 'substitution',
      lemma: 'ἑλώρια',
      reading: 'ἑλώριον',
      proposer: 'Berge',
      note: 'For the sake of the metre; not adopted.',
      ownerId,
    },
  ]);
  // A reported reading of a witness nobody has transcribed.
  const dId = await witness(db, ownerId, {
    slug: 'townleianus-t',
    siglum: 'T',
    name: 'Townleianus',
    repository: 'British Library',
    settlement: 'London',
    shelfmark: 'Burney 86',
    dateText: 'a. 1059',
    category: 'manuscript',
  });
  await db.insert(reportedReadings).values({
    id: newId(),
    workId,
    segmentId: segmentIdOf('1.1'),
    witnessId: dId,
    lemma: 'θεὰ',
    reading: 'θεά',
    source: "Allen's apparatus (1931)",
    ownerId,
  });
  await db
    .insert(editionSigla)
    .values({ editionId, witnessId: dId, transcriptionId: null, siglum: 'T', position: 3 });

  // The record of the work on the edition, so that every kind of archived record has one:
  // a citation and a note citing the literature, a zone on A's first page, an alignment constraint,
  // a site looked at and classed, review positions, a named moment, and a collaborator when one is given.
  const allen = await bibliographyItem(db, ownerId, {
    entryType: 'book',
    citationKey: 'allen1931',
    fields: { author: 'Allen, Thomas W.', title: 'Homeri Ilias', date: '1931', location: 'Oxford' },
    label: 'Allen 1931',
  });
  await setCitations(db, { conjectureId: zenodotus }, [{ itemId: allen, postnote: 'ad 1.5' }]);
  const editionTokens = content.items.filter((i): i is Token => i.kind === 'token');
  const firstWord = editionTokens[0]!;
  await addNote(
    db,
    editionId,
    {
      segmentId: segmentIdOf('1.1'),
      tokenIds: [firstWord.id],
      text: 'The first word states the theme.',
      citations: [{ itemId: allen, prenote: 'cf.' }],
    },
    ownerId,
  );
  const aTokens = aRead.items.filter((i): i is Token => i.kind === 'token');
  await createZones(db, aTranscription, aId, [
    {
      pageId: aPages[0]!,
      tokenIds: [aTokens[0]!.id],
      geometry: { rect: { x: 0.12, y: 0.08, w: 0.1, h: 0.03 } },
    },
  ]);
  const [bRow] = await db
    .select({ content: transcriptions.content })
    .from(transcriptions)
    .where(eq(transcriptions.id, bTranscription));
  const bFirst = bRow!.content.items.find((i): i is Token => i.kind === 'token')!;
  await db.insert(alignmentConstraints).values({
    id: newId(),
    editionId,
    segmentId: segmentIdOf('1.1'),
    baseTokenIds: [firstWord.id],
    transcriptionId: bTranscription,
    witnessTokenIds: [bFirst.id],
  });
  await reviewSite(db, editionId, segmentIdOf('1.2'), `${segmentIdOf('1.2')}:0`, ownerId);
  await setSiteKind(
    db,
    editionId,
    segmentIdOf('1.2'),
    `${segmentIdOf('1.2')}:0`,
    'textual',
    ownerId,
  );
  await setReviewFrom(db, 'edition', editionId, ownerId, 1);
  await setReviewFrom(db, 'transcription', aTranscription, ownerId, 1);
  await nameMoment(db, 'edition', editionId, 1, 'Collated against A, B and C', ownerId);
  // The transcripts are published, as versions of their own; the edition is left a draft.
  for (const id of [aTranscription, bTranscription, cTranscription])
    await publishTranscription(db, id, ownerId);
  if (options.collaboratorId)
    await db
      .insert(editionCollaborators)
      .values({ editionId, userId: options.collaboratorId, grantedBy: ownerId })
      .onConflictDoNothing();

  return {
    workId,
    editionId,
    editionSlug: 'iliad-1-working-edition',
    witnessIds: { A: aId, B: bId, C: cId, T: dId },
  };
}

async function witness(
  db: Database,
  ownerId: string,
  data: { slug: string; siglum: string; name: string } & Partial<typeof witnesses.$inferInsert>,
): Promise<string> {
  const id = newId();
  await db.insert(witnesses).values({ id, createdBy: ownerId, ...data });
  await db.insert(witnessMaintainers).values({ witnessId: id, userId: ownerId });
  return id;
}

/** A bibliography entry by its key: the existing one, or a new one. */
async function bibliographyItem(
  db: Database,
  ownerId: string,
  entry: { entryType: string; citationKey: string; fields: Record<string, string>; label: string },
): Promise<string> {
  const [existing] = await db
    .select({ id: bibliographyItems.id })
    .from(bibliographyItems)
    .where(eq(bibliographyItems.citationKey, entry.citationKey));
  if (existing) return existing.id;
  const id = newId();
  await db.insert(bibliographyItems).values({ id, createdBy: ownerId, ...entry });
  return id;
}

async function makePages(db: Database, witnessId: string, labels: string[]): Promise<string[]> {
  const ids = labels.map(() => newId());
  await db
    .insert(pages)
    .values(labels.map((label, i) => ({ id: ids[i]!, witnessId, label, position: i + 1 })));
  return ids;
}

async function transcription(
  db: Database,
  witnessId: string,
  ownerId: string,
  name: string,
  content: Stream,
  keepsWrittenForm: boolean,
): Promise<string> {
  const id = newId();
  await db.insert(transcriptions).values({ id, witnessId, name, ownerId, keepsWrittenForm });
  await replaceContent(db, 'transcription', id, ownerId, 0, content, 'seed');
  return id;
}
