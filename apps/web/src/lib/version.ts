/**
 * The running version of Varians: the version in apps/web/package.json and
 * the short commit it was built from, fixed at build time (vite.config.ts
 * reads the commit from VARIANS_COMMIT, or from git when the source is a
 * checkout). The footer, /health and /api/version show it; the footer also
 * links the source of the running version, which is how the offer of source
 * to the users of a network service (AGPL-3.0, section 13) is met.
 */

import { formatVersion, shortCommit } from './version-format';

export { REPOSITORY_URL, formatVersion, shortCommit, sourceUrl } from './version-format';

export const PACKAGE_VERSION: string = __VARIANS_VERSION__;
export const COMMIT: string | null = shortCommit(__VARIANS_COMMIT__);
export const VERSION: string = formatVersion(PACKAGE_VERSION, COMMIT);
