import { error, fail } from '@sveltejs/kit';
import { workRemotes } from '@varians/db';
import { and, eq } from 'drizzle-orm';
import { canMaintainWork } from '$lib/server/authz';
import type { ConflictPolicy } from '$lib/server/archive/import';
import { requireUser } from '$lib/server/guards';
import { packageOrigin } from '$lib/server/package-response';
import { workBySlug } from '$lib/server/registry';
import { storageRoot } from '$lib/server/startup';
import { addRemote, compareSync, pullRemote, pushRemote, remotesOf, summary, transportOf, RemoteError } from '$lib/server/sync';
import { site } from '$lib/strings/site';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

async function maintained(event: Pick<RequestEvent, 'locals' | 'params'>) {
  const user = requireUser(event.locals);
  const record = await workBySlug(event.locals.db, event.params.slug);
  if (!record) error(404, 'Not found');
  if (!canMaintainWork(user, record.work, record.maintainerIds)) error(403, 'Only the maintainers of the work keep its other installations');
  return { user, record };
}

async function remoteOf(event: Pick<RequestEvent, 'locals' | 'params'>, workId: string, id: string) {
  const [remote] = await event.locals.db.select().from(workRemotes).where(and(eq(workRemotes.id, id), eq(workRemotes.workId, workId)));
  if (!remote) error(404, 'Not found');
  return remote;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const load: PageServerLoad = async (event) => {
  const { record } = await maintained(event);
  const remotes = await remotesOf(event.locals.db, record.work.id);
  return {
    crumb: { label: site.remotes.title },
    work: { slug: record.work.slug, title: record.work.title },
    remotes: remotes.map((r) => ({
      id: r.id,
      origin: r.origin,
      slug: r.remoteSlug,
      hasToken: r.token !== null,
      pullEveryHours: r.pullEveryHours,
      lastPulledAt: r.lastPulledAt?.toISOString() ?? null,
      lastReport: r.lastReport as { documents?: { name: string; result: string }[]; refused?: string | null } | null,
    })),
  };
};

export const actions: Actions = {
  add: async (event) => {
    const { user, record } = await maintained(event);
    const form = await event.request.formData();
    const token = String(form.get('token') ?? '').trim() || null;
    if (token && !process.env.SECRET_KEY) return fail(400, { error: site.remotes.secretMissing });
    try {
      await addRemote(event.locals.db, user, record.work.id, String(form.get('address') ?? ''), token);
    } catch (cause) {
      return fail(400, { error: message(cause) });
    }
    return { done: 'add' as const };
  },

  compare: async (event) => {
    const { user, record } = await maintained(event);
    const remote = await remoteOf(event, record.work.id, String((await event.request.formData()).get('id') ?? ''));
    try {
      const differences = await compareSync(event.locals.db, user, record.work.id, await transportOf(remote).sync());
      return { done: 'compare' as const, remoteId: remote.id, differences };
    } catch (cause) {
      return fail(502, { error: message(cause) });
    }
  },

  pull: async (event) => {
    const { user, record } = await maintained(event);
    const form = await event.request.formData();
    const remote = await remoteOf(event, record.work.id, String(form.get('id') ?? ''));
    const chosen = String(form.get('policy') ?? 'report');
    const policy: ConflictPolicy = chosen === 'keep' || chosen === 'take' ? chosen : 'report';
    try {
      const report = await pullRemote(event.locals.db, user, remote, { policy, dryRun: form.get('preview') === '1' });
      return { done: 'pull' as const, remoteId: remote.id, preview: report.dryRun, report: summary(report) as { refused: string | null; documents: { name: string; kind: string; result: string; segments: string[] }[] } };
    } catch (cause) {
      if (cause instanceof RemoteError || cause instanceof Error) return fail(502, { error: message(cause) });
      throw cause;
    }
  },

  push: async (event) => {
    const { user, record } = await maintained(event);
    const remote = await remoteOf(event, record.work.id, String((await event.request.formData()).get('id') ?? ''));
    try {
      await pushRemote(event.locals.db, user, remote, { storageRoot: storageRoot(), origin: packageOrigin(event.url.origin) });
      return { done: 'push' as const, remoteId: remote.id };
    } catch (cause) {
      return fail(502, { error: message(cause) });
    }
  },

  schedule: async (event) => {
    const { record } = await maintained(event);
    const form = await event.request.formData();
    const remote = await remoteOf(event, record.work.id, String(form.get('id') ?? ''));
    const hours = Number(form.get('hours'));
    await event.locals.db.update(workRemotes).set({ pullEveryHours: Number.isInteger(hours) && hours >= 1 && hours <= 24 * 30 ? hours : null }).where(eq(workRemotes.id, remote.id));
    return { done: 'schedule' as const };
  },

  remove: async (event) => {
    const { record } = await maintained(event);
    const remote = await remoteOf(event, record.work.id, String((await event.request.formData()).get('id') ?? ''));
    await event.locals.db.delete(workRemotes).where(eq(workRemotes.id, remote.id));
    return { done: 'remove' as const };
  },
};
