/**
 * The windows of Make New Edition and Edition Settings, as form actions both
 * pages carry (and the editor's Witnesses and Sigla window posts to): a work,
 * a witness or a transcript, each saved with its window as a record of its
 * own. They answer with the record made instead of leading to its page.
 */
import { fail, type RequestEvent } from '@sveltejs/kit';
import type { ConspectusWitness, TranscriptChoice } from '$lib/edition/conspectus';
import { field } from '$lib/registry/forms';
import { registry } from '$lib/strings/registry';
import { grantsFor } from './authz.ts';
import { conspectusWitnesses } from './edition-form.ts';
import { requireUser } from './guards.ts';
import {
  transcriptionFromForm,
  witnessFromForm,
  workFromForm,
  type Made,
} from './registry-forms.ts';

/** A failure as a window shows it: the errors by field, or one message. */
function refused<T>(made: Extract<Made<T>, { ok: false }>) {
  return fail(made.status, {
    errors: made.errors ?? {},
    values: made.values ?? {},
    error: made.error ?? (made.errors ? null : registry.common.forbidden),
  });
}

export const windowActions = {
  /** Add New Work: the work registered, to be the edition's. */
  addWork: async ({ locals, request }: RequestEvent) => {
    const user = requireUser(locals);
    const made = await workFromForm(locals.db, user, await request.formData());
    if (!made.ok) return refused(made);
    const { id, slug, title, author } = made.record;
    return { work: { id, slug, title, author } };
  },

  /** Add New Witness: the witness registered, as a row of the conspectus needs it. */
  addWitness: async ({ locals, request }: RequestEvent) => {
    const user = requireUser(locals);
    const made = await witnessFromForm(locals.db, user, await request.formData());
    if (!made.ok) return refused(made);
    const found = await conspectusWitnesses(
      locals.db,
      user,
      await grantsFor(locals.db, user),
      [made.record.id],
      null,
    );
    return { witness: found[made.record.id] as ConspectusWitness };
  },

  /** Make New Transcript: a transcript of the witness named in `witnessId`, for the row it was made from. */
  newTranscript: async ({ locals, request }: RequestEvent) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const made = await transcriptionFromForm(locals.db, user, field(form, 'witnessId'), form);
    if (!made.ok) return refused(made);
    const transcript: TranscriptChoice = {
      id: made.record.id,
      name: made.record.name,
      ownerName: user.name,
      own: true,
      segments: 0,
    };
    return { transcript };
  },
};
