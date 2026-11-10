import { resolveFocus } from '$lib/reader/blocks';
import type { PageLoad } from './$types';

/** The segment a permalink names, by its label: scrolled to and lit briefly. */
export const load: PageLoad = ({ data, params }) => ({
  ...data,
  focus: resolveFocus(data.labelOf, params.segment),
});
