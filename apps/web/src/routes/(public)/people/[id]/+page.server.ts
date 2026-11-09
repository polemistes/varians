import { error } from '@sveltejs/kit';
import { persons } from '@varians/db';
import { eq } from 'drizzle-orm';
import { orcidUrl } from '@varians/core';
import type { PageServerLoad } from './$types';

/** A person named in the history of texts here: their name and ORCID iD, the page their address leads to. */
export const load: PageServerLoad = async ({ locals, params }) => {
  const [person] = await locals.db.select({ id: persons.id, name: persons.name, orcid: persons.orcid }).from(persons).where(eq(persons.id, params.id));
  if (!person) error(404, 'Not found');
  return { crumb: { label: person.name }, person: { ...person, orcidUrl: person.orcid ? orcidUrl(person.orcid) : null } };
};
