/**
 * The pages of a witness, as the pages screens show them.
 *   GET    the pages in order with thumbnails and viewer sources, whether the
 *          user maintains the witness, and the upload limit
 *
 * Witnesses are public, so anyone may read the list; changes go through the
 * form actions of /witnesses/[slug]/pages, which check the maintainers.
 */
import { error, json } from '@sveltejs/kit';
import { eq, witnesses } from '@varians/db';
import type { WitnessPagesData } from '$lib/components/pages/types';
import { canMaintainWitness } from '$lib/server/authz';
import { DEFAULT_MAX_UPLOAD_BYTES } from '$lib/server/images/tiles';
import { maintainerIdsOf, pageViewsOf } from '$lib/server/pages';
import { pageStrings } from '$lib/strings/pages';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  const [witness] = await locals.db.select().from(witnesses).where(eq(witnesses.id, params.id));
  if (!witness) throw error(404, pageStrings.errors.witnessNotFound);
  const [maintainers, pages] = await Promise.all([maintainerIdsOf(locals.db, witness.id), pageViewsOf(locals.db, witness.id)]);
  const data: WitnessPagesData = {
    witness: {
      id: witness.id,
      slug: witness.slug,
      name: witness.name,
      siglum: witness.siglum,
      iiifManifest: witness.iiifManifest,
      roll: witness.category === 'manuscript' && witness.format === 'roll',
      imageDefaults: { rights: witness.imageRights, attribution: witness.imageAttribution },
    },
    pages,
    canMaintain: canMaintainWitness(locals.user, witness, maintainers),
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  };
  return json(data);
};
