import { error } from '@sveltejs/kit';
import { render } from '$lib/guide/markdown';
import { isCurrentVersion, specification } from '$lib/server/formats';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  if (!isCurrentVersion(params.version)) error(404, 'Not found');
  const spec = await specification();
  if (!spec) error(404, 'Not found');
  const base = `/formats/${params.version}/`;
  const rendered = render(spec.markdown, { linkBase: base });
  return {
    crumb: { label: site.formats.title },
    html: rendered.html,
    contents: rendered.headings.filter((h) => h.level === 2),
    base,
    schemas: spec.schemas,
    hasOdd: spec.hasOdd,
    hasExample: spec.hasExample,
  };
};
