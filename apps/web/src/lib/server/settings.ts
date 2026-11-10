/**
 * Installation settings shared by the server and the command line. The
 * server's modules that read SvelteKit's environment pass the value in; the
 * archive and the scripts read the process environment.
 */

import { isDataLicence, type DataLicence } from '@varians/core';

/** The installation's name, used in citations, mail and package metadata (SITE_NAME, default Varians). */
export function siteName(value: string | undefined = process.env.SITE_NAME): string {
  return value?.trim() || 'Varians';
}

/**
 * The licence of records published here (DATA_LICENCE): CC0-1.0, CC-BY-4.0
 * or CC-BY-SA-4.0, CC-BY-SA-4.0 by default. Another value is refused
 * loudly rather than replaced quietly.
 */
export function dataLicence(value: string | undefined = process.env.DATA_LICENCE): DataLicence {
  const v = value?.trim();
  if (!v) return 'CC-BY-SA-4.0';
  if (!isDataLicence(v))
    throw new Error(`DATA_LICENCE must be CC0-1.0, CC-BY-4.0 or CC-BY-SA-4.0, not ${v}`);
  return v;
}
