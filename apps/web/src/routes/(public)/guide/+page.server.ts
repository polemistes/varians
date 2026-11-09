import { guide } from '$lib/guide/source';
import { site } from '$lib/strings/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
  crumb: { label: site.guide.title },
  html: guide.html,
  contents: guide.headings.filter((h) => h.level === 2),
});
