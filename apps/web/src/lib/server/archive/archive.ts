/**
 * The archive: a work's records as open files in a git repository, kept
 * current by the server (PLAN 4.12). This module writes the files from the
 * database and commits. Format: docs/formats/README.md.
 */

import { materialLabel } from '$lib/registry/witness';
import {
  apparatusEntries,
  splitEntries,
  exportEditionTei,
  exportTranscriptionTei,
  formatApparatus,
  newId,
  segmentRuns,
  serializeBiblatex,
  toText,
  units,
} from '@varians/core';
import {
  archiveCommits,
  bibliographyItems,
  changesets,
  citations,
  conjectures,
  editionAdoptions,
  editionSigla,
  editions,
  moments,
  notes,
  pages,
  referenceSchemes,
  reportedReadings,
  segments,
  transcriptionSegments,
  transcriptions,
  users,
  witnesses,
  workMaintainers,
  works,
  zones,
  type Database,
} from '@varians/db';
import { execFile, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, asc, eq, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { collateEdition } from '../collation.ts';
import { exportHands, teiForm } from '../witness-format.ts';
import { apparatusConventionsOf, contextAt } from '../reader.ts';
import { siglaOrderOf } from '../../reader/sites.ts';
import { chosenWorksOf } from '../transcription-works.ts';

const run = promisify(execFile);

/** Options of an export; the archive uses the core exporters by default. */
export interface ArchiveWriters {
  tei?: boolean;
  /** The storage directory, so that uploaded originals are copied into the archive. */
  storageRoot?: string;
  /** Only the records one person may see, for a download; the server's own archive keeps everything. */
  only?: ArchiveFilter;
}

/** Which records an export takes. */
export interface ArchiveFilter {
  transcription(row: typeof transcriptions.$inferSelect): boolean;
  edition(row: typeof editions.$inferSelect): boolean;
  conjecture(row: typeof conjectures.$inferSelect): boolean;
  reported(row: typeof reportedReadings.$inferSelect): boolean;
  /** Whether the person sees an edition's working state; otherwise the archive holds its published version only. */
  editionWorking(row: typeof editions.$inferSelect): boolean;
}

/** Optional string fields of a row as the TEI exporter takes them: nulls left out. */
function defined<T extends Record<string, string | null | undefined>>(record: T): { [K in keyof T]?: string } {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) if (typeof value === 'string' && value !== '') out[key] = value;
  return out as { [K in keyof T]?: string };
}

function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

async function historyFiles(
  db: Database,
  dir: string,
  kind: 'transcription' | 'edition',
  documentId: string,
  userNames: Map<string, string>,
  upTo: number | null = null,
): Promise<void> {
  const rows = await db
    .select()
    .from(changesets)
    .where(and(eq(changesets.documentKind, kind), eq(changesets.documentId, documentId), upTo !== null ? lte(changesets.version, upTo) : undefined))
    .orderBy(asc(changesets.version));
  const lines = rows.map((c) =>
    JSON.stringify({
      id: c.id,
      version: c.version,
      userId: c.userId,
      userName: c.userId ? userNames.get(c.userId) ?? null : null,
      at: c.at.toISOString(),
      ops: c.ops,
      reverse: c.reverse,
      message: c.message ?? null,
    }),
  );
  await writeText(path.join(dir, 'history.ndjson'), lines.join('\n') + (lines.length ? '\n' : ''));
  const named = await db
    .select()
    .from(moments)
    .where(and(eq(moments.documentKind, kind), eq(moments.documentId, documentId), upTo !== null ? lte(moments.version, upTo) : undefined))
    .orderBy(asc(moments.version));
  await writeJson(
    path.join(dir, 'moments.json'),
    named.map((m) => ({ id: m.id, version: m.version, name: m.name, kind: m.kind, number: m.number, at: m.at.toISOString() })),
  );
}

/** Write a work's archive directory from the database. Existing files are replaced; the `.git` directory is kept. */
export async function writeArchive(db: Database, workId: string, root: string, writers: ArchiveWriters = {}): Promise<string> {
  const [work] = await db.select().from(works).where(eq(works.id, workId));
  if (!work) throw new Error(`no work ${workId}`);
  const [scheme] = await db.select().from(referenceSchemes).where(eq(referenceSchemes.id, work.schemeId));
  const dir = path.join(root, work.slug);
  await mkdir(dir, { recursive: true });
  // Clear everything but .git so removed records disappear from the archive.
  for (const entry of ['work.json', 'segments.tsv', 'conjectures.json', 'reported-readings.json', 'witnesses', 'editions', 'README.md', 'bibliography.bib']) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
  const userRows = await db.select({ id: users.id, name: users.name }).from(users);
  const userNames = new Map(userRows.map((u) => [u.id, u.name] as const));
  const maintainerRows = await db.select({ userId: workMaintainers.userId }).from(workMaintainers).where(eq(workMaintainers.workId, workId));

  await writeJson(path.join(dir, 'work.json'), {
    id: work.id,
    slug: work.slug,
    title: work.title,
    author: work.author,
    language: work.language,
    identifier: work.identifier,
    description: work.description,
    visibility: work.visibility,
    scheme: scheme ? { id: scheme.id, name: scheme.name, levels: scheme.levels } : null,
    profile: work.profile,
    maintainers: maintainerRows.map((m) => ({ id: m.userId, name: userNames.get(m.userId) ?? null })),
    createdAt: work.createdAt.toISOString(),
    formatVersion: 1,
  });
  const segmentRows = await db.select().from(segments).where(eq(segments.workId, workId)).orderBy(segments.sortKey);
  const labelOf = new Map(segmentRows.map((s) => [s.id, s.label] as const));
  await writeText(
    path.join(dir, 'segments.tsv'),
    ['id\tlabel\tsort_key\taddress', ...segmentRows.map((s) => `${s.id}\t${s.label}\t${s.sortKey}\t${JSON.stringify(s.address)}`)].join('\n') + '\n',
  );
  const only = writers.only;
  const conjectureRows = (await db.select().from(conjectures).where(eq(conjectures.workId, workId))).filter((c) => !only || only.conjecture(c));
  await writeJson(
    path.join(dir, 'conjectures.json'),
    conjectureRows.map((c) => ({ ...c, segmentLabel: labelOf.get(c.segmentId) ?? null, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() })),
  );
  const reported = (await db.select().from(reportedReadings).where(eq(reportedReadings.workId, workId))).filter((r) => !only || only.reported(r));
  await writeJson(
    path.join(dir, 'reported-readings.json'),
    reported.map((r) => ({ ...r, segmentLabel: labelOf.get(r.segmentId) ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
  );

  // Witnesses connected to the work: through the conspectus of its editions, reported readings, or transcriptions assigning to it.
  const editionRows = (await db.select().from(editions).where(eq(editions.workId, workId))).filter((e) => !only || only.edition(e));
  const siglaRows = editionRows.length
    ? await db.select().from(editionSigla).where(inArray(editionSigla.editionId, editionRows.map((e) => e.id)))
    : [];
  const assigning = await db
    .selectDistinct({ transcriptionId: transcriptionSegments.transcriptionId })
    .from(transcriptionSegments)
    .where(eq(transcriptionSegments.workId, workId));
  const transcriptionIds = new Set<string>([
    ...assigning.map((a) => a.transcriptionId),
    ...siglaRows.map((s) => s.transcriptionId).filter((id): id is string => id !== null),
  ]);
  const transcriptionRows = (transcriptionIds.size ? await db.select().from(transcriptions).where(inArray(transcriptions.id, [...transcriptionIds])) : []).filter(
    (t) => !only || only.transcription(t),
  );
  const witnessIds = new Set<string>([
    ...transcriptionRows.map((t) => t.witnessId),
    ...siglaRows.map((s) => s.witnessId),
    ...reported.map((r) => r.witnessId),
  ]);
  const witnessRows = witnessIds.size ? await db.select().from(witnesses).where(inArray(witnesses.id, [...witnessIds])) : [];
  for (const witness of witnessRows) {
    const wdir = path.join(dir, 'witnesses', witness.slug);
    await writeJson(path.join(wdir, 'witness.json'), { ...witness, createdAt: witness.createdAt.toISOString(), updatedAt: witness.updatedAt.toISOString() });
    const pageRows = await db.select().from(pages).where(eq(pages.witnessId, witness.id)).orderBy(pages.position);
    const imageFiles = new Map<string, string>();
    if (writers.storageRoot) {
      for (const p of pageRows) {
        if (p.imageKind !== 'upload' || !p.imagePath) continue;
        const ext = path.extname(p.imagePath) || '.jpg';
        const target = path.join('images', `${slugify(p.label)}-${p.id.slice(-6)}${ext}`);
        try {
          await mkdir(path.join(wdir, 'images'), { recursive: true });
          await copyFile(path.join(writers.storageRoot, p.imagePath), path.join(wdir, target));
          imageFiles.set(p.id, target);
        } catch {
          // A missing original is left out of the archive rather than failing the whole export.
        }
      }
    }
    await writeJson(
      path.join(wdir, 'pages.json'),
      pageRows.map((p) => ({
        id: p.id,
        label: p.label,
        position: p.position,
        image: p.imageKind
          ? { kind: p.imageKind, path: p.imagePath, file: imageFiles.get(p.id) ?? null, iiif: p.imageIiif, width: p.imageWidth, height: p.imageHeight }
          : null,
      })),
    );
    const chosen = await chosenWorksOf(db, transcriptionRows.map((t) => t.id));
    for (const t of transcriptionRows.filter((t) => t.witnessId === witness.id)) {
      const tdir = path.join(wdir, 'transcriptions', slugify(t.name));
      await writeJson(path.join(tdir, 'transcription.json'), {
        id: t.id,
        name: t.name,
        witnessId: t.witnessId,
        ownerId: t.ownerId,
        ownerName: userNames.get(t.ownerId) ?? null,
        visibility: t.visibility,
        version: t.version,
        keepsWrittenForm: t.keepsWrittenForm,
        displayAsWritten: t.displayAsWritten,
        profile: t.profile,
        description: t.description,
        sources: t.sources,
        licence: t.licence,
        workIds: chosen.get(t.id) ?? [],
        content: t.content,
      });
      await writeJson(path.join(tdir, 'memory.json'), t.memory);
      const zoneRows = await db.select().from(zones).where(eq(zones.transcriptionId, t.id));
      await writeJson(
        path.join(tdir, 'zones.json'),
        zoneRows.map((z) => ({ id: z.id, pageId: z.pageId, tokenIds: z.tokenIds, geometry: z.geometry, feature: z.feature })),
      );
      await writeText(path.join(tdir, 'transcription.txt'), toText(t.content, { form: 'read' }) + '\n');
      if (writers.tei !== false) {
        const segmentLabels: Record<string, string> = {};
        for (const [id, label] of labelOf) segmentLabels[id] = label;
        await writeText(
          path.join(tdir, 'transcription.tei.xml'),
          exportTranscriptionTei({
            stream: t.content,
            title: `${work.title}: ${witness.name}, ${t.name}`,
            language: work.language,
            ...(t.sources ? { sources: t.sources } : {}),
            ...(t.licence ? { licence: t.licence } : {}),
            witness: {
              ...defined({
                siglum: witness.siglum,
                name: witness.name,
                repository: witness.repository,
                settlement: witness.settlement,
                idno: witness.shelfmark,
                date: witness.dateText,
                material: materialLabel(witness.material),
                extent: witness.extent,
                description: witness.description,
              }),
              ...(witness.hands.length ? { hands: exportHands(witness.hands) } : {}),
              ...(teiForm(witness) ? { form: teiForm(witness)! } : {}),
            },
            pages: pageRows.map((p) => ({
              id: p.id,
              label: p.label,
              ...(p.imageIiif ? { imageUrl: `${p.imageIiif}/full/max/0/default.jpg` } : p.imagePath ? { imageUrl: p.imagePath } : {}),
              ...(p.imageWidth ? { width: p.imageWidth } : {}),
              ...(p.imageHeight ? { height: p.imageHeight } : {}),
            })),
            zones: zoneRows.map((z) => ({ id: z.id, pageId: z.pageId, tokenIds: z.tokenIds, geometry: z.geometry })),
            segmentLabels,
            words: true,
            regularizations: true,
          }),
        );
      }
      await historyFiles(db, tdir, 'transcription', t.id, userNames);
    }
  }

  for (const edition of editionRows) {
    const edir = path.join(dir, 'editions', edition.slug);
    // Someone who does not edit the edition gets the version readers see, with the history up to it.
    const working = !only || only.editionWorking(edition);
    if (!working && edition.publishedVersion === null) continue;
    const shownVersion = working ? null : edition.publishedVersion;
    const { context: shown, asOf } = await contextAt(db, edition.id, shownVersion);
    const sigla = working
      ? siglaRows.filter((s) => s.editionId === edition.id).sort((a, b) => a.position - b.position)
      : shown.sigla.map((s, position) => ({ ...s, editionId: edition.id, position }));
    const adoptions = await db.select().from(editionAdoptions).where(eq(editionAdoptions.editionId, edition.id));
    const noteRows = await db.select().from(notes).where(and(eq(notes.editionId, edition.id), asOf ? lte(notes.createdAt, asOf) : undefined));
    await writeJson(path.join(edir, 'edition.json'), {
      id: edition.id,
      slug: edition.slug,
      title: edition.title,
      editors: edition.editors,
      preface: edition.preface,
      ownerId: edition.ownerId,
      ownerName: userNames.get(edition.ownerId) ?? null,
      visibility: edition.visibility,
      version: shown.edition.version,
      publishedVersion: edition.publishedVersion,
      conventions: edition.conventions,
      copiedFrom: edition.copiedFrom,
      sources: edition.sources,
      licence: edition.licence,
      sigla: sigla.map((s) => ({ siglum: s.siglum, witnessId: s.witnessId, transcriptionId: s.transcriptionId, states: s.states, variantSiglum: s.variantSiglum })),
      adoptions: adoptions.map((a) => a.conjectureId),
      notes: noteRows.map((n) => ({ id: n.id, segmentId: n.segmentId, segmentLabel: labelOf.get(n.segmentId) ?? null, tokenIds: n.tokenIds, text: n.text, authorId: n.authorId })),
      siteKinds: [...shown.siteKinds].flatMap(([segmentId, bySite]) => [...bySite].map(([siteKey, k]) => ({ segmentId, siteKey, kind: k.kind }))),
      content: shown.edition.content,
    });
    const text = await editionText(db, edition.id, labelOf, shownVersion);
    await writeText(path.join(edir, 'edition.txt'), text.plain);
    await writeText(path.join(edir, 'edition.md'), text.markdown);
    if (writers.tei !== false) {
      const witnessNames = new Map(witnessRows.map((w) => [w.id, w.name] as const));
      await writeText(
        path.join(edir, 'edition.tei.xml'),
        exportEditionTei({
          title: edition.title,
          ...(edition.editors.length ? { editors: edition.editors } : {}),
          language: work.language,
          ...(edition.preface ? { preface: edition.preface } : {}),
          ...(edition.sources ? { sources: edition.sources } : {}),
          ...(edition.licence ? { licence: edition.licence } : {}),
          baseSiglum: 'ed.',
          witnesses: sigla.map((s) => ({ siglum: s.siglum, ...(witnessNames.get(s.witnessId) ? { name: witnessNames.get(s.witnessId)! } : {}) })),
          segments: text.segments,
        }),
      );
    }
    await historyFiles(db, edir, 'edition', edition.id, userNames, shownVersion);
  }

  const all = await citationsOfWork(db, workId);
  // An export for one person keeps the citations of what it holds, and the entries they cite.
  const shown = { conjectures: new Set(conjectureRows.map((c) => c.id)), reported: new Set(reported.map((r) => r.id)), editions: new Set(editionRows.map((e) => e.id)) };
  const citationRows = only
    ? all.citations.filter(
        (c) =>
          (!c.conjectureId || shown.conjectures.has(c.conjectureId)) &&
          (!c.reportedReadingId || shown.reported.has(c.reportedReadingId)) &&
          (!c.editionId || shown.editions.has(c.editionId)),
      )
    : all.citations;
  const citedIds = new Set(citationRows.map((c) => c.itemId));
  const items = all.items.filter((i) => citedIds.has(i.id));
  await writeText(path.join(dir, 'bibliography.bib'), serializeBiblatex(items.map((r) => ({ type: r.entryType, key: r.citationKey, fields: r.fields }))));
  await writeJson(path.join(dir, 'bibliography.json'), items);
  await writeJson(path.join(dir, 'citations.json'), citationRows);
  const formats = formatsDir();
  if (!formats) console.warn('docs/formats not found: the archive gets no README, TEI notes or schemas');
  const readme = formats ? await readFile(path.join(formats, 'README.md'), 'utf8').catch(() => null) : null;
  await writeText(path.join(dir, 'README.md'), readme ?? '# Varians archive\n');
  const teiDoc = formats ? await readFile(path.join(formats, 'tei-subset.md'), 'utf8').catch(() => null) : null;
  if (teiDoc) await writeText(path.join(dir, 'tei-subset.md'), teiDoc);
  if (formats) {
    try {
      const schemaDir = path.join(formats, 'schemas');
      for (const name of await readdir(schemaDir)) {
        if (name.endsWith('.json')) await writeText(path.join(dir, 'schemas', name), await readFile(path.join(schemaDir, name), 'utf8'));
      }
    } catch {
      // Schemas are documentation; an archive without them is still complete.
    }
  }
  return dir;
}

/**
 * The format documentation the archive carries (docs/formats in the
 * repository), found upward from the working directory and from this module,
 * since the built server runs from another depth than the source.
 */
export function formatsDir(): string | null {
  const starts = [process.env.VARIANS_FORMATS_DIR ? path.dirname(path.dirname(process.env.VARIANS_FORMATS_DIR)) : null, process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  if (process.env.VARIANS_FORMATS_DIR && existsSync(path.join(process.env.VARIANS_FORMATS_DIR, 'README.md'))) return process.env.VARIANS_FORMATS_DIR;
  for (const start of starts) {
    if (!start) continue;
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'docs', 'formats');
      if (existsSync(path.join(candidate, 'README.md'))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** The critical text with its apparatus under each segment, as plain text, as Markdown, and as the input of the TEI export. */
export async function editionText(
  db: Database,
  editionId: string,
  labelOf: Map<string, string>,
  atVersion: number | null = null,
): Promise<{ plain: string; markdown: string; segments: Parameters<typeof exportEditionTei>[0]['segments'] }> {
  const { context } = await contextAt(db, editionId, atVersion);
  const [row] = await db.select({ conventions: editions.conventions }).from(editions).where(eq(editions.id, editionId));
  const conventions = apparatusConventionsOf(row!.conventions);
  const collations = await collateEdition(db, context);
  const plain: string[] = [];
  const markdown: string[] = [];
  const segmentsOut: Parameters<typeof exportEditionTei>[0]['segments'] = [];
  const runs = segmentRuns(context.edition.content).filter((r) => r.segmentId !== null);
  const siglaOrder = siglaOrderOf(context.sigla);
  // Runs of one segment are gathered, so that a segment printed in two places is one entry.
  const bySegment = new Map<string, typeof runs>();
  for (const run of runs) bySegment.set(run.segmentId!, [...(bySegment.get(run.segmentId!) ?? []), run]);
  for (const [segmentId, segmentRunsHere] of bySegment) {
    const label = labelOf.get(segmentId) ?? segmentId;
    const items = segmentRunsHere.flatMap((run) => context.edition.content.items.slice(run.from, run.to));
    const text = toText({ items }, { form: 'read' });
    const collation = collations.get(segmentId);
    const { main, interpretative } = collation ? splitEntries(apparatusEntries(collation, label, {}, conventions, siglaOrder), conventions) : { main: [], interpretative: [] };
    const app = [...formatApparatus(main, conventions), ...formatApparatus(interpretative, conventions).map((line) => `Interpretative: ${line}`)];
    plain.push(`${label}  ${text}`);
    for (const line of app) plain.push(`    ${line}`);
    markdown.push(`**${label}** ${text}  `);
    for (const line of app) markdown.push(`> ${line}  `);
    const baseUnits = segmentRunsHere.flatMap((run) => units(context.edition.content, run.from, run.to));
    segmentsOut.push({ label, items, baseUnits, sites: collation?.sites ?? [] });
  }
  return { plain: plain.join('\n') + '\n', markdown: markdown.join('\n') + '\n', segments: segmentsOut };
}

/** The citations made by the work's conjectures, reported readings, editions and notes, and the items they cite. */
export async function citationsOfWork(
  db: Database,
  workId: string,
): Promise<{
  items: { id: string; entryType: string; citationKey: string; fields: Record<string, string>; label: string }[];
  citations: (typeof citations.$inferSelect)[];
}> {
  const conjectureIds = (await db.select({ id: conjectures.id }).from(conjectures).where(eq(conjectures.workId, workId))).map((r) => r.id);
  const reportedIds = (await db.select({ id: reportedReadings.id }).from(reportedReadings).where(eq(reportedReadings.workId, workId))).map((r) => r.id);
  const editionIds = (await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId))).map((r) => r.id);
  const conditions = [
    conjectureIds.length ? inArray(citations.conjectureId, conjectureIds) : undefined,
    reportedIds.length ? inArray(citations.reportedReadingId, reportedIds) : undefined,
    editionIds.length ? inArray(citations.editionId, editionIds) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (conditions.length === 0) return { items: [], citations: [] };
  const rows = await db
    .select()
    .from(citations)
    .where(and(isNotNull(citations.itemId), or(...conditions)));
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const items = itemIds.length
    ? await db
        .select({ id: bibliographyItems.id, entryType: bibliographyItems.entryType, citationKey: bibliographyItems.citationKey, fields: bibliographyItems.fields, label: bibliographyItems.label })
        .from(bibliographyItems)
        .where(inArray(bibliographyItems.id, itemIds))
    : [];
  return { items, citations: rows };
}

/** Every bibliography item cited by the work, as biblatex. */
export async function bibliographyOfWork(db: Database, workId: string): Promise<string> {
  const { items } = await citationsOfWork(db, workId);
  return serializeBiblatex(items.map((r) => ({ type: r.entryType, key: r.citationKey, fields: r.fields })));
}

/** Commit the archive directory, initializing the repository the first time. Returns the commit hash, or null when nothing changed. */
export async function commitArchive(dir: string, message: string, author = { name: 'Varians', email: 'varians@localhost' }): Promise<string | null> {
  const git = (...args: string[]) => run('git', args, { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(dir)) } });
  // The archive is a repository of its own. Asking git whether we are inside a repository is not enough:
  // the storage directory may sit inside a checkout, and the commit would land there.
  if (!existsSync(path.join(dir, '.git'))) await git('init', '-q', '-b', 'main');
  const top = (await git('rev-parse', '--show-toplevel')).stdout.trim();
  if (path.resolve(top) !== path.resolve(dir)) throw new Error(`the archive at ${dir} is not a repository of its own (git found ${top})`);
  await git('add', '-A');
  const status = await git('status', '--porcelain');
  if (status.stdout.trim() === '') return null;
  await git(
    '-c',
    `user.name=${author.name}`,
    '-c',
    `user.email=${author.email}`,
    'commit',
    '-q',
    '-m',
    message,
  );
  const hash = await git('rev-parse', 'HEAD');
  return hash.stdout.trim();
}

/** Write and commit a work's archive; records the commit. */
export async function archiveWork(db: Database, workId: string, root: string, reason: string, writers: ArchiveWriters = {}): Promise<string | null> {
  const dir = await writeArchive(db, workId, root, writers);
  const hash = await commitArchive(dir, reason);
  if (hash) {
    await db.insert(archiveCommits).values({ id: newId(), workId, commitHash: hash, reason });
  }
  return hash;
}

/**
 * The archive of a work as one person may see it, for a download: written
 * afresh into a temporary repository with one commit (the server's archive
 * history may hold other people's drafts) and streamed as a zip. The
 * temporary directory goes when the stream ends.
 */
export async function filteredArchiveZip(db: Database, work: { id: string; slug: string }, only: ArchiveFilter, storageRoot: string): Promise<Readable> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-export-'));
  const cleanup = () => void rm(tmp, { recursive: true, force: true });
  try {
    const dir = await writeArchive(db, work.id, tmp, { storageRoot, only });
    await commitArchive(dir, `export of ${work.slug}`);
    const child = spawn('git', ['archive', '--format=zip', `--prefix=${work.slug}/`, 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    child.on('close', cleanup);
    child.on('error', (e) => {
      child.stdout.destroy(e);
      cleanup();
    });
    return child.stdout;
  } catch (e) {
    cleanup();
    throw e;
  }
}
