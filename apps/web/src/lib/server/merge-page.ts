/**
 * The page "Merge into…" of a work or witness: choosing the surviving entry
 * by search, the preview, and the merge itself. The routes for works and
 * witnesses share it.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { canMergeEntries, grantsFor, isAdministrator, type Actor } from './authz';
import { seesWork } from './edition-access.ts';
import { requireUser } from './guards';
import { searchRegistry, witnessBySlug, workBySlug } from './registry';
import {
  isBlocked,
  mergeWitnesses,
  mergeWorks,
  previewWitnessMerge,
  previewWorkMerge,
  type MergeKind,
  type MergePreview,
} from './registry-merge';
import { field } from '$lib/registry/forms';
import { hitDetail } from '$lib/registry/search';
import { registry as t } from '$lib/strings/registry';

interface LoadedEntry {
  id: string;
  slug: string;
  name: string;
  createdBy: string | null;
  maintainerIds: string[];
}

async function entryBySlug(
  locals: App.Locals,
  kind: MergeKind,
  slug: string,
): Promise<LoadedEntry | null> {
  if (kind === 'work') {
    const record = await workBySlug(locals.db, slug);
    return record
      ? {
          id: record.work.id,
          slug: record.work.slug,
          name: record.work.title,
          createdBy: record.work.createdBy,
          maintainerIds: record.maintainerIds,
        }
      : null;
  }
  const record = await witnessBySlug(locals.db, slug);
  return record
    ? {
        id: record.witness.id,
        slug: record.witness.slug,
        name: record.witness.name,
        createdBy: record.witness.createdBy,
        maintainerIds: record.maintainerIds,
      }
    : null;
}

/** The entry for someone who might merge it: an administrator or one of its maintainers. */
async function mergeable(
  locals: App.Locals,
  kind: MergeKind,
  slug: string,
  user: Actor,
): Promise<LoadedEntry> {
  const entry = await entryBySlug(locals, kind, slug);
  if (!entry) error(404, kind === 'work' ? t.work.notFound : t.witness.notFound);
  const maintains =
    isAdministrator(user) || entry.createdBy === user.id || entry.maintainerIds.includes(user.id);
  if (!maintains) error(403, t.merge.notAllowed);
  return entry;
}

const base = (kind: MergeKind) => (kind === 'work' ? '/works' : '/witnesses');

export interface MergePageData {
  kind: MergeKind;
  entry: { id: string; slug: string; name: string };
  q: string;
  hits: { id: string; slug: string; title: string; detail: string }[];
  preview: MergePreview | null;
  allowed: boolean;
  blocked: boolean;
}

export async function loadMergePage(
  locals: App.Locals,
  kind: MergeKind,
  slug: string,
  url: URL,
): Promise<MergePageData & { crumb: { label: string; href: string } }> {
  const user = requireUser(locals, url.pathname + url.search);
  const entry = await mergeable(locals, kind, slug, user);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const grants = await grantsFor(locals.db, user);
  const hits = q
    ? (await searchRegistry(locals.db, kind, q, user, grants))
        .filter((hit) => hit.id !== entry.id)
        .map((hit) => ({ id: hit.id, slug: hit.slug, title: hit.title, detail: hitDetail(hit) }))
    : [];
  let preview: MergePreview | null = null;
  let allowed = false;
  const intoSlug = url.searchParams.get('into');
  if (intoSlug) {
    const into = await entryBySlug(locals, kind, intoSlug);
    if (into && into.id !== entry.id) {
      // A private work the user may not see is not offered by the search, and not previewed either.
      const visible = kind === 'witness' || (await seesWork(locals.db, user, into.id));
      if (visible) {
        preview =
          kind === 'work'
            ? await previewWorkMerge(locals.db, entry.id, into.id)
            : await previewWitnessMerge(locals.db, entry.id, into.id);
        allowed = canMergeEntries(user, entry, into);
      }
    }
  }
  return {
    crumb: { label: entry.name, href: `${base(kind)}/${entry.slug}` },
    kind,
    entry: { id: entry.id, slug: entry.slug, name: entry.name },
    q,
    hits,
    preview,
    allowed,
    blocked: preview ? isBlocked(preview) : false,
  };
}

/** The merge action: done, then to the survivor's page; refused with the reason otherwise. */
export async function runMerge(
  locals: App.Locals,
  kind: MergeKind,
  slug: string,
  request: Request,
) {
  const user = requireUser(locals);
  const entry = await mergeable(locals, kind, slug, user);
  const intoId = field(await request.formData(), 'intoId');
  if (!intoId) return fail(400, { error: t.common.invalidForm });
  if (intoId === entry.id) return fail(400, { error: t.merge.same });
  const result =
    kind === 'work'
      ? await mergeWorks(locals.db, entry.id, intoId, user)
      : await mergeWitnesses(locals.db, entry.id, intoId, user);
  if (!result.ok) {
    if (result.error === 'forbidden') return fail(403, { error: t.merge.notAllowed });
    if (result.error === 'blocked') return fail(409, { error: t.merge.blocked });
    if (result.error === 'same') return fail(400, { error: t.merge.same });
    return fail(404, { error: t.merge.gone });
  }
  redirect(303, `${base(kind)}/${result.preview.into.slug}`);
}
