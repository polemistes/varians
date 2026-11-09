/**
 * A record as the archive represents it (Varians Data Format 2), for its
 * address with `Accept: application/json` (PLAN-2 C9). Records the archive
 * writes as files of their own (works, witnesses, transcriptions, editions)
 * are written for the viewer, by the archive writer, and read back; the
 * others are given in the shape their archive file lists them in.
 */

import {
  bibliographyItems,
  changesets,
  editions,
  pages,
  persons,
  registryMerges,
  segments,
  transcriptions,
  users,
  witnessMaintainers,
  witnesses,
  works,
  type Database,
} from '@varians/db';
import { passageUrn, type Item } from '@varians/core';
import { asc, eq } from 'drizzle-orm';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { FORMAT_BASE, writeRecordPart } from './archive/archive.ts';
import { worksOfDocument } from './archive/commits.ts';
import { viewerFilter } from './archive/viewer.ts';
import type { Actor } from './authz.ts';
import { documentAt } from './documents/service.ts';
import { workBySlug } from './registry.ts';
import type { Resolved, Visibility } from './resolver.ts';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Write the part of a work's archive that holds a record, for the viewer, and read one of its files. */
async function fromArchive(db: Database, user: Actor | null, workId: string, part: Parameters<typeof writeRecordPart>[2], file: (paths: Awaited<ReturnType<typeof writeRecordPart>>['paths']) => string | null): Promise<unknown> {
  const [work] = await db.select({ slug: works.slug }).from(works).where(eq(works.id, workId));
  const record = work ? await workBySlug(db, work.slug) : null;
  const only = await viewerFilter(db, user, record?.maintainerIds ?? []);
  const written = await writeRecordPart(db, workId, part, only);
  try {
    const relative = file(written.paths);
    if (relative === null) return null;
    return JSON.parse(await readFile(path.join(written.dir, relative), 'utf8')) as unknown;
  } catch {
    return null;
  } finally {
    await rm(written.root, { recursive: true, force: true });
  }
}

async function fromList(db: Database, user: Actor | null, workId: string, file: string, key: string, id: string): Promise<unknown> {
  const data = (await fromArchive(db, user, workId, {}, () => file)) as Record<string, { id: string }[]> | null;
  return data?.[key]?.find((r) => r.id === id) ?? null;
}

/** The record an address names, as the archive represents it; null when the viewer may not see it in that form. */
export async function recordJson(db: Database, user: Actor | null, resolved: Resolved, visibility: Visibility): Promise<unknown> {
  switch (resolved.kind) {
    case 'work':
      return fromArchive(db, user, resolved.workId, {}, () => 'work.json');
    case 'conjecture':
      return fromList(db, user, resolved.workId, 'conjectures.json', 'conjectures', resolved.id);
    case 'reported-reading':
      return fromList(db, user, resolved.workId, 'reported-readings.json', 'readings', resolved.id);
    case 'transcription':
    case 'edition': {
      const [workId] = resolved.kind === 'edition' ? [resolved.workId] : await worksOfDocument(db, 'transcription', resolved.id);
      if (!workId) return null;
      const key = resolved.kind === 'edition' ? 'editions' : 'transcriptions';
      return fromArchive(db, user, workId, { [key]: [resolved.id] }, (paths) => {
        const dir = (resolved.kind === 'edition' ? paths.edition : paths.transcription).get(resolved.id);
        return dir ? path.join(dir, `${resolved.kind}.json`) : null;
      });
    }
    case 'witness':
    case 'page': {
      const witnessId = resolved.kind === 'witness' ? resolved.id : resolved.witnessId;
      const [w] = await db.select().from(witnesses).where(eq(witnesses.id, witnessId));
      if (!w) return null;
      if (resolved.kind === 'page') {
        const [p] = await db.select().from(pages).where(eq(pages.id, resolved.id));
        if (!p) return null;
        return {
          id: p.id,
          witnessId: p.witnessId,
          label: p.label,
          position: p.position,
          image: p.imageKind
            ? { kind: p.imageKind, iiif: p.imageIiif, width: p.imageWidth, height: p.imageHeight, rights: p.rights, attribution: p.attribution, source: p.imageSource }
            : null,
          createdAt: iso(p.createdAt),
        };
      }
      const maintainers = await db
        .select({ id: witnessMaintainers.userId, name: users.name, since: witnessMaintainers.createdAt })
        .from(witnessMaintainers)
        .innerJoin(users, eq(users.id, witnessMaintainers.userId))
        .where(eq(witnessMaintainers.witnessId, w.id))
        .orderBy(asc(witnessMaintainers.userId));
      const merged = await db.select().from(registryMerges).where(eq(registryMerges.survivorId, w.id)).orderBy(asc(registryMerges.oldId));
      return {
        $schema: `${FORMAT_BASE}witness.schema.json`,
        ...w,
        maintainers: maintainers.map((m) => ({ id: m.id, name: m.name, since: iso(m.since) })),
        mergedIds: merged.map((m) => ({ id: m.oldId, label: m.label, mergedBy: m.mergedBy, mergedAt: iso(m.mergedAt) })),
        createdAt: iso(w.createdAt),
        updatedAt: iso(w.updatedAt),
      };
    }
    case 'segment': {
      const [row] = await db
        .select({ id: segments.id, workId: segments.workId, label: segments.label, sortKey: segments.sortKey, address: segments.address, createdAt: segments.createdAt, identifier: works.identifier, schemeId: works.schemeId })
        .from(segments)
        .innerJoin(works, eq(works.id, segments.workId))
        .where(eq(segments.id, resolved.id));
      if (!row) return null;
      const record = await workBySlug(db, resolved.workSlug);
      const levels = record?.scheme?.levels ?? [];
      return { id: row.id, workId: row.workId, label: row.label, sortKey: row.sortKey, address: row.address, urn: passageUrn(row.identifier, row.address, levels), createdAt: iso(row.createdAt) };
    }
    case 'bibliography': {
      const [item] = await db.select().from(bibliographyItems).where(eq(bibliographyItems.id, resolved.id));
      return item ? { ...item, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) } : null;
    }
    case 'person': {
      const [p] = await db.select({ id: persons.id, name: persons.name, orcid: persons.orcid }).from(persons).where(eq(persons.id, resolved.id));
      return p ?? null;
    }
    case 'changeset': {
      const [c] = await db.select().from(changesets).where(eq(changesets.id, resolved.id));
      if (!c) return null;
      return {
        id: c.id,
        documentKind: c.documentKind,
        documentId: c.documentId,
        parentId: c.parentId,
        ...(c.merged ? { merged: c.merged } : {}),
        version: c.version,
        personId: c.personId,
        at: c.at.toISOString(),
        ops: c.ops,
        reverse: c.reverse,
        message: c.message,
      };
    }
    case 'token': {
      let items: Item[];
      if (resolved.documentKind === 'transcription') {
        const [t] = await db.select({ content: transcriptions.content }).from(transcriptions).where(eq(transcriptions.id, resolved.documentId));
        items = t?.content.items ?? [];
      } else {
        const [e] = await db.select({ content: editions.content, publishedVersion: editions.publishedVersion }).from(editions).where(eq(editions.id, resolved.documentId));
        if (!e) return null;
        items = visibility.edits || e.publishedVersion === null ? e.content.items : (await documentAt(db, 'edition', resolved.documentId, e.publishedVersion)).items;
      }
      const item = items.find((i) => i.id === resolved.id);
      return item ? { document: { kind: resolved.documentKind, id: resolved.documentId }, item } : null;
    }
  }
}
