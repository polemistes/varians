import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** The pages under /dev try components out while building; production does not serve them. */
export const load: LayoutServerLoad = () => {
  if (!dev) throw error(404, 'Not found');
  return {};
};
