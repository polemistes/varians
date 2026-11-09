/**
 * The normalization memory of a transcription.
 *   GET            the remembered pairs
 *   POST { form, norm } | { forget: form }
 */
import { error, json } from '@sveltejs/kit';
import { NormalizationMemory } from '@varians/core';
import { transcriptions } from '@varians/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { loadTranscriptionAccess } from '$lib/server/transcription-access';

const word = z.string().min(1).max(200);
const body = z.union([z.object({ form: word, norm: word }), z.object({ forget: word })]);

/** A memory holds the pairs of one transcription; this many is far beyond any real one. */
const MAX_PAIRS = 50_000;

export const GET: RequestHandler = async ({ locals, params }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such transcription');
  return json({ memory: access.transcription.memory });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const access = await loadTranscriptionAccess(locals.db, locals.user, params.id);
  if (!access || !access.canView) throw error(404, 'No such transcription');
  if (!access.canEdit) throw error(403, 'You may not edit this transcription');
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'form and norm, or forget, are required');
  const memory = new NormalizationMemory(access.transcription.memory);
  if ('forget' in parsed.data) memory.forget(parsed.data.forget);
  else memory.remember(parsed.data.form, parsed.data.norm);
  const entries = memory.toJSON();
  if (entries.length > MAX_PAIRS) throw error(400, 'The memory is full');
  await locals.db.update(transcriptions).set({ memory: entries }).where(eq(transcriptions.id, params.id));
  return json({ memory: entries });
};
