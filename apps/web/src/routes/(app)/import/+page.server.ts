import { fail } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  importPackage,
  WEB_LIMITS,
  type PackageImportReport,
} from '$lib/server/archive/import-package';
import { limits } from '$lib/server/rate-limit';
import type { ConflictPolicy } from '$lib/server/archive/import';
import { requireUser } from '$lib/server/guards';
import { site } from '$lib/strings/site';
import type { Actions, PageServerLoad } from './$types';

/** Uploads wait here between the preview and the import, an hour at most. */
const UPLOADS = path.join(os.tmpdir(), 'varians-uploads');
const KEEP_MS = 60 * 60 * 1000;

async function sweep(): Promise<void> {
  try {
    for (const name of await readdir(UPLOADS)) {
      const file = path.join(UPLOADS, name);
      if (Date.now() - (await stat(file)).mtimeMs > KEEP_MS) await rm(file, { force: true });
    }
  } catch {
    // Nothing there yet.
  }
}

function uploadPath(userId: string, token: string): string | null {
  if (!/^[0-9a-f]{32}$/u.test(token)) return null;
  return path.join(UPLOADS, `${userId.replace(/[^0-9A-Za-z]/gu, '')}-${token}.zip`);
}

/** The report as the page shows it: plain data. */
function view(report: PackageImportReport) {
  return {
    bag: report.bag,
    refused: report.refused,
    problems: report.problems.slice(0, 50),
    dryRun: report.dryRun,
    works: report.works.map((w) => ({
      workId: w.workId,
      documents: w.documents.map((d) => ({
        kind: d.kind,
        name: d.name,
        result: d.result,
        segments: d.segments,
        // Why two texts conflict, for the wording of the report; other reasons stay here.
        ...(d.result === 'conflict' && d.reason ? { reason: d.reason } : {}),
      })),
      matches: w.matches,
      possibleDuplicates: w.possibleDuplicates,
      createdPersons: w.persons.createdNames,
      warnings: w.warnings,
    })),
  };
}

export const load: PageServerLoad = ({ locals }) => {
  requireUser(locals);
  return { crumb: { label: site.import.title } };
};

export const actions: Actions = {
  preview: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const file = form.get('package');
    if (!(file instanceof File) || file.size === 0) return fail(400, { error: site.import.noFile });
    if (!limits.importsByUser.take(user.id)) return fail(429, { error: site.import.tooOften });
    await sweep();
    await mkdir(UPLOADS, { recursive: true, mode: 0o700 });
    const token = randomBytes(16).toString('hex');
    const target = uploadPath(user.id, token)!;
    await pipeline(
      Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream),
      createWriteStream(target, { mode: 0o600 }),
    );
    const report = await importPackage(locals.db, target, user.id, {
      dryRun: true,
      actor: user,
      onConflict: 'report',
      source: file.name,
      limits: WEB_LIMITS,
    });
    if (report.refused) await rm(target, { force: true });
    return {
      stage: 'preview' as const,
      token: report.refused ? null : token,
      name: file.name,
      report: view(report),
    };
  },

  run: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const target = uploadPath(user.id, String(form.get('token') ?? ''));
    if (!target || !existsSync(target)) return fail(400, { error: site.import.expired });
    const chosen = String(form.get('policy') ?? 'report');
    const policy: ConflictPolicy = chosen === 'keep' || chosen === 'take' ? chosen : 'report';
    if (!limits.importsByUser.take(user.id)) return fail(429, { error: site.import.tooOften });
    try {
      const report = await importPackage(locals.db, target, user.id, {
        actor: user,
        onConflict: policy,
        source: String(form.get('name') ?? 'a package'),
        limits: WEB_LIMITS,
      });
      return {
        stage: 'done' as const,
        token: null,
        name: String(form.get('name') ?? ''),
        report: view(report),
      };
    } finally {
      await rm(target, { force: true });
    }
  },
};
