import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Making an edition starts on a page of its own; old links lead there. */
export const load: PageServerLoad = () => {
  redirect(308, '/editions/new');
};
