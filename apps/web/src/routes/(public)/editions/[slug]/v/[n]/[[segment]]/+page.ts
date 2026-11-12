import { resolveFocus } from '$lib/reader/blocks';
import { unpackReader } from '$lib/reader/wire';
import type { PageLoad } from './$types';

/**
 * The page's segments as they travel are put in the shape the components use,
 * and the segment a permalink names, by its label, is found: scrolled to and
 * lit briefly.
 */
export const load: PageLoad = ({ data, params }) => ({
  ...unpackReader(data),
  focus: resolveFocus(data.labelOf, params.segment),
});
