/**
 * Every record has an address, /id/<id>: this module finds
 * which record an id names, wherever it is kept, and whether a viewer may
 * see it. Ids merged away resolve to their survivor. Words have no table of
 * their own: a token id is looked up inside the texts.
 */

import {
  bibliographyItems,
  changesets,
  conjectures,
  editions,
  pages,
  persons,
  registryMerges,
  reportedReadings,
  segments,
  transcriptions,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { and, eq, sql } from 'drizzle-orm';
import { canEditEdition, canEditTranscription, canViewConjecture, canViewEdition, canViewTranscription, canViewWork, grantsFor, type Actor, type Grants } from './authz.ts';
import { workBySlug } from './registry.ts';
import { documentAt } from './documents/service.ts';

export type Resolved =
  | { kind: 'work'; id: string; workId: string; slug: string }
  | { kind: 'witness'; id: string; slug: string }
  | { kind: 'page'; id: string; witnessSlug: string; witnessId: string }
  | { kind: 'transcription'; id: string }
  | { kind: 'edition'; id: string; slug: string; workId: string }
  | { kind: 'segment'; id: string; workId: string; workSlug: string; label: string }
  | { kind: 'conjecture'; id: string; workId: string; workSlug: string }
  | { kind: 'reported-reading'; id: string; workId: string; workSlug: string }
  | { kind: 'bibliography'; id: string; key: string }
  | { kind: 'person'; id: string }
  | { kind: 'changeset'; id: string; documentKind: 'transcription' | 'edition'; documentId: string }
  | { kind: 'token'; id: string; documentKind: 'transcription' | 'edition'; documentId: string };

/** Whether a string can be a record id: what the router lets through is checked again here. */
export function isRecordId(value: string): boolean {
  return /^[0-9A-Za-z_-]{1,64}$/u.test(value);
}

/** The record an id names, following merges; null when none does. */
export async function resolveId(db: Database, id: string): Promise<Resolved | null> {
  if (!isRecordId(id)) return null;
  const [merged] = await db.select({ survivorId: registryMerges.survivorId }).from(registryMerges).where(eq(registryMerges.oldId, id));
  if (merged) return resolveId(db, merged.survivorId);

  const [work] = await db.select({ id: works.id, slug: works.slug }).from(works).where(eq(works.id, id));
  if (work) return { kind: 'work', id, workId: work.id, slug: work.slug };
  const [witness] = await db.select({ slug: witnesses.slug }).from(witnesses).where(eq(witnesses.id, id));
  if (witness) return { kind: 'witness', id, slug: witness.slug };
  const [page] = await db.select({ witnessId: pages.witnessId, slug: witnesses.slug }).from(pages).innerJoin(witnesses, eq(witnesses.id, pages.witnessId)).where(eq(pages.id, id));
  if (page) return { kind: 'page', id, witnessSlug: page.slug, witnessId: page.witnessId };
  const [transcription] = await db.select({ id: transcriptions.id }).from(transcriptions).where(eq(transcriptions.id, id));
  if (transcription) return { kind: 'transcription', id };
  const [edition] = await db.select({ slug: editions.slug, workId: editions.workId }).from(editions).where(eq(editions.id, id));
  if (edition) return { kind: 'edition', id, slug: edition.slug, workId: edition.workId };
  const [segment] = await db.select({ workId: segments.workId, label: segments.label, slug: works.slug }).from(segments).innerJoin(works, eq(works.id, segments.workId)).where(eq(segments.id, id));
  if (segment) return { kind: 'segment', id, workId: segment.workId, workSlug: segment.slug, label: segment.label };
  const [conjecture] = await db.select({ workId: conjectures.workId, slug: works.slug }).from(conjectures).innerJoin(works, eq(works.id, conjectures.workId)).where(eq(conjectures.id, id));
  if (conjecture) return { kind: 'conjecture', id, workId: conjecture.workId, workSlug: conjecture.slug };
  const [reported] = await db.select({ workId: reportedReadings.workId, slug: works.slug }).from(reportedReadings).innerJoin(works, eq(works.id, reportedReadings.workId)).where(eq(reportedReadings.id, id));
  if (reported) return { kind: 'reported-reading', id, workId: reported.workId, workSlug: reported.slug };
  const [item] = await db.select({ key: bibliographyItems.citationKey }).from(bibliographyItems).where(eq(bibliographyItems.id, id));
  if (item) return { kind: 'bibliography', id, key: item.key };
  const [person] = await db.select({ id: persons.id }).from(persons).where(eq(persons.id, id));
  if (person) return { kind: 'person', id };
  const [changeset] = await db.select({ kind: changesets.documentKind, documentId: changesets.documentId }).from(changesets).where(eq(changesets.id, id));
  if (changeset) return { kind: 'changeset', id, documentKind: changeset.kind, documentId: changeset.documentId };
  // A word: inside the text of a transcription or an edition.
  const contains = (column: typeof transcriptions.content | typeof editions.content) => sql`${column} -> 'items' @> ${JSON.stringify([{ id }])}::jsonb`;
  const [inTranscription] = await db.select({ id: transcriptions.id }).from(transcriptions).where(contains(transcriptions.content)).limit(1);
  if (inTranscription) return { kind: 'token', id, documentKind: 'transcription', documentId: inTranscription.id };
  const [inEdition] = await db.select({ id: editions.id }).from(editions).where(contains(editions.content)).limit(1);
  if (inEdition) return { kind: 'token', id, documentKind: 'edition', documentId: inEdition.id };
  return null;
}

/** What a viewer may do with a resolved record: see it at all, and edit the document it is in. */
export interface Visibility {
  visible: boolean;
  /** For documents and their words and changesets: whether the viewer edits it (and so sees its working state). */
  edits: boolean;
}

async function workVisible(db: Database, user: Actor | null, grants: Grants, workId: string): Promise<{ visible: boolean; maintainerIds: string[] }> {
  const [row] = await db.select({ slug: works.slug }).from(works).where(eq(works.id, workId));
  if (!row) return { visible: false, maintainerIds: [] };
  const record = await workBySlug(db, row.slug);
  if (!record) return { visible: false, maintainerIds: [] };
  return { visible: canViewWork(user, record.work, record.maintainerIds, grants), maintainerIds: record.maintainerIds };
}

async function documentVisibility(db: Database, user: Actor | null, grants: Grants, kind: 'transcription' | 'edition', id: string): Promise<Visibility> {
  if (kind === 'transcription') {
    const [t] = await db.select({ id: transcriptions.id, ownerId: transcriptions.ownerId, visibility: transcriptions.visibility }).from(transcriptions).where(eq(transcriptions.id, id));
    if (!t) return { visible: false, edits: false };
    return { visible: canViewTranscription(user, t, grants), edits: canEditTranscription(user, t, grants) };
  }
  const [e] = await db.select({ id: editions.id, ownerId: editions.ownerId, visibility: editions.visibility, workId: editions.workId }).from(editions).where(eq(editions.id, id));
  if (!e) return { visible: false, edits: false };
  const collaborators = user && grants.collaboratingEditionIds.has(e.id) ? [user.id] : [];
  if (!(await workVisible(db, user, grants, e.workId)).visible) return { visible: false, edits: false };
  return { visible: canViewEdition(user, e, collaborators), edits: canEditEdition(user, e, collaborators) };
}

/** Whether a viewer may see a resolved record, by the same rules as its pages. */
export async function visibilityOf(db: Database, user: Actor | null, resolved: Resolved): Promise<Visibility> {
  const grants = await grantsFor(db, user);
  switch (resolved.kind) {
    case 'witness':
    case 'page':
    case 'bibliography':
    case 'person':
      return { visible: true, edits: false };
    case 'work':
    case 'segment':
      return { visible: (await workVisible(db, user, grants, resolved.workId)).visible, edits: false };
    case 'conjecture':
    case 'reported-reading': {
      const work = await workVisible(db, user, grants, resolved.workId);
      if (!work.visible) return { visible: false, edits: false };
      const table = resolved.kind === 'conjecture' ? conjectures : reportedReadings;
      const [row] = await db.select({ id: table.id, ownerId: table.ownerId, workId: table.workId, visibility: table.visibility }).from(table).where(eq(table.id, resolved.id));
      if (!row) return { visible: false, edits: false };
      return { visible: canViewConjecture(user, row, { workMaintainerIds: work.maintainerIds, grants }), edits: false };
    }
    case 'transcription':
      return documentVisibility(db, user, grants, 'transcription', resolved.id);
    case 'edition':
      return documentVisibility(db, user, grants, 'edition', resolved.id);
    case 'changeset':
    case 'token': {
      const document = await documentVisibility(db, user, grants, resolved.documentKind, resolved.documentId);
      if (!document.visible || document.edits || resolved.documentKind === 'transcription') return document;
      // In an edition someone does not edit: only what its published version holds.
      const [e] = await db.select({ publishedVersion: editions.publishedVersion }).from(editions).where(eq(editions.id, resolved.documentId));
      if (e?.publishedVersion === null || e?.publishedVersion === undefined) return { visible: false, edits: false };
      if (resolved.kind === 'changeset') {
        const [c] = await db.select({ version: changesets.version }).from(changesets).where(and(eq(changesets.id, resolved.id)));
        return { visible: c?.version !== null && c?.version !== undefined && c.version <= e.publishedVersion, edits: false };
      }
      // A word of the working text that the published version does not have is not found.
      const published = await documentAt(db, 'edition', resolved.documentId, e.publishedVersion);
      return published.items.some((i) => i.id === resolved.id) ? document : { visible: false, edits: false };
    }
  }
}

/** The page a resolved record is shown on. */
export async function pageOf(db: Database, resolved: Resolved, visibility: Visibility): Promise<string> {
  const enc = encodeURIComponent;
  switch (resolved.kind) {
    case 'work':
      return `/works/${enc(resolved.slug)}`;
    case 'witness':
      return `/witnesses/${enc(resolved.slug)}`;
    case 'page':
      return `/witnesses/${enc(resolved.witnessSlug)}/pages`;
    case 'transcription':
      return `/transcriptions/${enc(resolved.id)}`;
    case 'edition':
      return visibility.edits ? `/editions/${enc(resolved.slug)}/edit` : `/editions/${enc(resolved.slug)}`;
    case 'segment': {
      // A published edition of the work at the segment, where there is one; else the work.
      const [published] = await db
        .select({ slug: editions.slug })
        .from(editions)
        .where(and(eq(editions.workId, resolved.workId), eq(editions.visibility, 'published')))
        .orderBy(editions.createdAt)
        .limit(1);
      return published ? `/editions/${enc(published.slug)}/${enc(resolved.label)}` : `/works/${enc(resolved.workSlug)}`;
    }
    case 'conjecture':
    case 'reported-reading':
      return `/works/${enc(resolved.workSlug)}`;
    case 'bibliography':
      return `/bibliography?q=${enc(resolved.key)}`;
    case 'person':
      return `/people/${enc(resolved.id)}`;
    case 'changeset':
    case 'token': {
      const word = resolved.kind === 'token' ? `?word=${enc(resolved.id)}` : '';
      if (resolved.documentKind === 'transcription') return `/transcriptions/${enc(resolved.documentId)}${word}`;
      const [e] = await db.select({ slug: editions.slug }).from(editions).where(eq(editions.id, resolved.documentId));
      const slug = enc(e?.slug ?? resolved.documentId);
      return visibility.edits ? `/editions/${slug}/edit${word}` : `/editions/${slug}${word}`;
    }
  }
}
