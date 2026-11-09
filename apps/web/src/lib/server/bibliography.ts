/**
 * The shared bibliography (PLAN 4.9): biblatex entries anyone signed in may
 * add, kept by whoever added them and by site editors, and the citations
 * that conjectures, reported readings, notes and editions make of them.
 */
import { citationLabel, disambiguateLabels, newId, parseBiblatex, serializeBiblatex, type BibEntry } from '@varians/core';
import { bibliographyItems, citations, conjectures, editions, notes, reportedReadings, type Database } from '@varians/db';
import { and, asc, count, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { formatCitation, referenceText } from '$lib/bibliography/format';
import { isAdministrator, isSiteEditor, type Actor, type Maybe } from './authz.ts';
import { PUBLIC, recordFilter, type Audience } from './audience.ts';

export type BibItem = typeof bibliographyItems.$inferSelect;

export function entryOf(item: Pick<BibItem, 'entryType' | 'citationKey' | 'fields'>): BibEntry {
  return { type: item.entryType, key: item.citationKey, fields: item.fields };
}

/** Whoever added an entry keeps it, with the site editors. */
export function canEditBibItem(user: Maybe<Actor>, item: Pick<BibItem, 'createdBy'>): boolean {
  if (!user) return false;
  return isSiteEditor(user) || item.createdBy === user.id;
}

/** Deleting is for whoever added the entry and administrators; site editors edit but do not delete. */
export function canDeleteBibItem(user: Maybe<Actor>, item: Pick<BibItem, 'createdBy'>): boolean {
  if (!user) return false;
  return isAdministrator(user) || item.createdBy === user.id;
}

function pattern(q: string): string {
  return `%${q.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;
}

function matching(q: string) {
  const p = pattern(q);
  return or(
    ilike(bibliographyItems.label, p),
    ilike(bibliographyItems.citationKey, p),
    sql`${bibliographyItems.fields}->>'title' ilike ${p}`,
    sql`${bibliographyItems.fields}->>'author' ilike ${p}`,
    sql`${bibliographyItems.fields}->>'editor' ilike ${p}`,
  );
}

/** Entries matching a search, ordered by label, with how often each is cited. */
export async function listBibliography(
  db: Database,
  options: { q?: string; limit?: number; offset?: number } = {},
): Promise<{ items: (BibItem & { cited: number })[]; total: number }> {
  const q = options.q?.trim() ?? '';
  const where = q ? matching(q) : undefined;
  const rows = await db
    .select()
    .from(bibliographyItems)
    .where(where)
    .orderBy(asc(bibliographyItems.label), asc(bibliographyItems.citationKey))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);
  const [total] = await db.select({ n: count() }).from(bibliographyItems).where(where);
  const counts = await citationCounts(
    db,
    rows.map((r) => r.id),
  );
  return { items: rows.map((r) => ({ ...r, cited: counts.get(r.id) ?? 0 })), total: total?.n ?? 0 };
}

export async function citationCounts(db: Database, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: citations.itemId, n: count() }).from(citations).where(inArray(citations.itemId, ids)).groupBy(citations.itemId);
  return new Map(rows.map((r) => [r.id, r.n] as const));
}

function sameEntry(a: BibEntry, b: BibEntry): boolean {
  if (a.type !== b.type) return false;
  const ka = Object.keys(a.fields).sort();
  const kb = Object.keys(b.fields).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a.fields[k] === b.fields[k]);
}

export interface ImportSummary {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Keys that exist and belong to someone else; the existing entry was kept. */
  kept: string[];
  warnings: string[];
}

/** Read `.bib` text into the bibliography: new keys are added, the user's own entries updated, others' kept. */
export async function importBibliography(db: Database, text: string, user: Actor): Promise<ImportSummary> {
  const parsed = parseBiblatex(text);
  const summary: ImportSummary = { created: [], updated: [], unchanged: [], kept: [], warnings: [...parsed.warnings] };
  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    if (seen.has(entry.key)) {
      summary.warnings.push(`The key ${entry.key} appears more than once; the first was used.`);
      continue;
    }
    seen.add(entry.key);
    const [existing] = await db.select().from(bibliographyItems).where(eq(bibliographyItems.citationKey, entry.key));
    if (!existing) {
      await db.insert(bibliographyItems).values({ id: newId(), entryType: entry.type, citationKey: entry.key, fields: entry.fields, label: citationLabel(entry), createdBy: user.id });
      summary.created.push(entry.key);
    } else if (sameEntry(entryOf(existing), entry)) {
      summary.unchanged.push(entry.key);
    } else if (canEditBibItem(user, existing)) {
      await db.update(bibliographyItems).set({ entryType: entry.type, fields: entry.fields, label: citationLabel(entry) }).where(eq(bibliographyItems.id, existing.id));
      summary.updated.push(entry.key);
    } else {
      summary.kept.push(entry.key);
    }
  }
  return summary;
}

export type SaveResult = { ok: true; item: BibItem } | { ok: false; error: 'parse' | 'count' | 'duplicate' | 'forbidden' | 'missing'; message: string };

/** Add an entry, or replace one, from the biblatex text of exactly one entry. */
export async function saveEntry(db: Database, id: string | null, text: string, user: Actor): Promise<SaveResult> {
  const parsed = parseBiblatex(text);
  if (parsed.entries.length === 0) return { ok: false, error: 'parse', message: parsed.warnings[0] ?? 'No entry could be read. An entry looks like @book{key, title = {…}}.' };
  if (parsed.entries.length > 1) return { ok: false, error: 'count', message: 'Give one entry at a time; use Import for several.' };
  const entry = parsed.entries[0]!;
  const [sameKey] = await db.select().from(bibliographyItems).where(eq(bibliographyItems.citationKey, entry.key));
  if (id === null) {
    if (sameKey) return { ok: false, error: 'duplicate', message: `The key ${entry.key} is taken.` };
    const [item] = await db
      .insert(bibliographyItems)
      .values({ id: newId(), entryType: entry.type, citationKey: entry.key, fields: entry.fields, label: citationLabel(entry), createdBy: user.id })
      .returning();
    return { ok: true, item: item! };
  }
  const [existing] = await db.select().from(bibliographyItems).where(eq(bibliographyItems.id, id));
  if (!existing) return { ok: false, error: 'missing', message: 'That entry no longer exists.' };
  if (!canEditBibItem(user, existing)) return { ok: false, error: 'forbidden', message: 'Only whoever added the entry, or a site editor, may change it.' };
  if (sameKey && sameKey.id !== id) return { ok: false, error: 'duplicate', message: `The key ${entry.key} is taken.` };
  const [item] = await db
    .update(bibliographyItems)
    .set({ entryType: entry.type, citationKey: entry.key, fields: entry.fields, label: citationLabel(entry) })
    .where(eq(bibliographyItems.id, id))
    .returning();
  return { ok: true, item: item! };
}

/** Remove an entry nothing cites. */
export async function deleteEntry(db: Database, id: string, user: Actor): Promise<{ ok: true } | { ok: false; error: 'cited' | 'forbidden' | 'missing'; cited?: number }> {
  const [existing] = await db.select().from(bibliographyItems).where(eq(bibliographyItems.id, id));
  if (!existing) return { ok: false, error: 'missing' };
  if (!canDeleteBibItem(user, existing)) return { ok: false, error: 'forbidden' };
  const cited = (await citationCounts(db, [id])).get(id) ?? 0;
  if (cited > 0) return { ok: false, error: 'cited', cited };
  await db.delete(bibliographyItems).where(eq(bibliographyItems.id, id));
  return { ok: true };
}

/** Entries as `.bib` text: all of them, or those named. */
export async function bibText(db: Database, ids?: string[]): Promise<string> {
  if (ids && ids.length === 0) return '';
  const rows = await db
    .select()
    .from(bibliographyItems)
    .where(ids ? inArray(bibliographyItems.id, ids) : undefined)
    .orderBy(asc(bibliographyItems.label), asc(bibliographyItems.citationKey));
  return serializeBiblatex(rows.map(entryOf));
}

// Citations

export type CitationTarget = { conjectureId: string } | { reportedReadingId: string } | { noteId: string; editionId: string } | { editionId: string };

export interface CitationInput {
  itemId: string;
  prenote?: string | null;
  postnote?: string | null;
}

export interface CitationView {
  itemId: string;
  key: string;
  label: string;
  prenote: string | null;
  postnote: string | null;
  /** "cf. West 1998, 45" */
  text: string;
}

function targetCondition(target: CitationTarget) {
  if ('conjectureId' in target) return eq(citations.conjectureId, target.conjectureId);
  if ('reportedReadingId' in target) return eq(citations.reportedReadingId, target.reportedReadingId);
  if ('noteId' in target) return eq(citations.noteId, target.noteId);
  return and(eq(citations.editionId, target.editionId), sql`${citations.noteId} is null`);
}

function targetColumns(target: CitationTarget) {
  if ('conjectureId' in target) return { conjectureId: target.conjectureId };
  if ('reportedReadingId' in target) return { reportedReadingId: target.reportedReadingId };
  if ('noteId' in target) return { noteId: target.noteId, editionId: target.editionId };
  return { editionId: target.editionId };
}

/** Replace what a record cites. Unknown items are left out. */
export async function setCitations(db: Database, target: CitationTarget, list: CitationInput[]): Promise<void> {
  const ids = [...new Set(list.map((c) => c.itemId))];
  const known = new Set(ids.length ? (await db.select({ id: bibliographyItems.id }).from(bibliographyItems).where(inArray(bibliographyItems.id, ids))).map((r) => r.id) : []);
  await db.transaction(async (tx) => {
    await tx.delete(citations).where(targetCondition(target));
    const rows = list
      .filter((c) => known.has(c.itemId))
      .map((c, position) => ({
        id: newId(),
        itemId: c.itemId,
        prenote: c.prenote?.trim() || null,
        postnote: c.postnote?.trim() || null,
        position,
        ...targetColumns(target),
      }));
    if (rows.length) await tx.insert(citations).values(rows);
  });
}

async function viewsOf(db: Database, rows: (typeof citations.$inferSelect)[]): Promise<Map<string, BibItem>> {
  const ids = [...new Set(rows.map((r) => r.itemId))];
  const items = ids.length ? await db.select().from(bibliographyItems).where(inArray(bibliographyItems.id, ids)) : [];
  return new Map(items.map((i) => [i.id, i] as const));
}

function view(row: typeof citations.$inferSelect, item: BibItem): CitationView {
  return { itemId: item.id, key: item.citationKey, label: item.label, prenote: row.prenote, postnote: row.postnote, text: formatCitation(item.label, row.prenote, row.postnote) };
}

export async function citationsOf(db: Database, target: CitationTarget): Promise<CitationView[]> {
  const rows = await db.select().from(citations).where(targetCondition(target)).orderBy(asc(citations.position));
  const items = await viewsOf(db, rows);
  return rows.flatMap((r) => {
    const item = items.get(r.itemId);
    return item ? [view(r, item)] : [];
  });
}

/** What each of several records cites, by record id. */
export async function citationsByRecord(
  db: Database,
  kind: 'conjecture' | 'reported' | 'note',
  ids: string[],
): Promise<Map<string, CitationView[]>> {
  const out = new Map<string, CitationView[]>();
  if (!ids.length) return out;
  const column = kind === 'conjecture' ? citations.conjectureId : kind === 'reported' ? citations.reportedReadingId : citations.noteId;
  const rows = await db.select().from(citations).where(inArray(column, ids)).orderBy(asc(citations.position));
  const items = await viewsOf(db, rows);
  for (const r of rows) {
    const owner = kind === 'conjecture' ? r.conjectureId : kind === 'reported' ? r.reportedReadingId : r.noteId;
    const item = items.get(r.itemId);
    if (!owner || !item) continue;
    out.set(owner, [...(out.get(owner) ?? []), view(r, item)]);
  }
  return out;
}

export interface WorkCited {
  id: string;
  key: string;
  /** The label as the edition prints it, with a, b where two would read alike. */
  label: string;
  reference: string;
}

/**
 * An edition's works cited: what its notes, its own citations, and the
 * conjectures and reported readings its apparatus prints for this audience
 * cite (for readers, the work's published records), in label order.
 */
export async function editionWorksCited(db: Database, editionId: string, audience: Audience = PUBLIC): Promise<WorkCited[]> {
  const [edition] = await db.select({ id: editions.id, workId: editions.workId, ownerId: editions.ownerId }).from(editions).where(eq(editions.id, editionId));
  if (!edition) return [];
  const sees = await recordFilter(db, edition.workId, audience);
  const conjectureIds = (await db.select().from(conjectures).where(eq(conjectures.workId, edition.workId))).filter(sees).map((r) => r.id);
  const reportedIds = (await db.select().from(reportedReadings).where(eq(reportedReadings.workId, edition.workId))).filter(sees).map((r) => r.id);
  const noteIds = (await db.select({ id: notes.id }).from(notes).where(eq(notes.editionId, editionId))).map((r) => r.id);
  const conditions = [
    eq(citations.editionId, editionId),
    conjectureIds.length ? inArray(citations.conjectureId, conjectureIds) : undefined,
    reportedIds.length ? inArray(citations.reportedReadingId, reportedIds) : undefined,
    noteIds.length ? inArray(citations.noteId, noteIds) : undefined,
  ].filter((c) => c !== undefined);
  const itemIds = [...new Set((await db.selectDistinct({ id: citations.itemId }).from(citations).where(and(isNotNull(citations.itemId), or(...conditions)))).map((r) => r.id))];
  if (!itemIds.length) return [];
  const items = await db.select().from(bibliographyItems).where(inArray(bibliographyItems.id, itemIds)).orderBy(asc(bibliographyItems.label), asc(bibliographyItems.citationKey));
  const labels = disambiguateLabels(items.map((i) => i.label));
  return items.map((item, i) => ({ id: item.id, key: item.citationKey, label: labels[i]!, reference: referenceText(entryOf(item)) }));
}
