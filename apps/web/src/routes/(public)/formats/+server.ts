/** /formats: the current version of the data format. */
import { redirect } from '@sveltejs/kit';
import { FORMAT_VERSION } from '$lib/server/archive/archive';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => redirect(308, `/formats/${FORMAT_VERSION}`);
