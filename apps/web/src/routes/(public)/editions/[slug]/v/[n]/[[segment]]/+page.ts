import { resolveFocus } from '$lib/reader/blocks';
import { unpackReader } from '$lib/reader/wire';
import type { PageLoad } from './$types';

/**
 * The page's segments as they travel are put in the shape the components use,
 * and the segment a permalink names, by its label, is found: scrolled to and
 * lit briefly. A withdrawn version has no text to unpack.
 */
export const load: PageLoad = ({ data, params }) => {
  if (data.withdrawn) return { withdrawn: data.withdrawn, crumb: data.crumb };
  const { withdrawn: _withdrawn, ...rest } = data;
  return {
    withdrawn: null,
    ...unpackReader(rest),
    focus: resolveFocus(rest.labelOf, params.segment),
  };
};
