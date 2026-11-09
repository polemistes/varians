/**
 * The pure parts of the version (version.ts has the constants of the build):
 * kept apart so that the command-line scripts can use them from source,
 * where the build's constants do not exist.
 */

/** The public repository of Varians. */
export const REPOSITORY_URL = 'https://github.com/polemistes/varians';

/** A commit as git abbreviates it, or null when the value is not a commit. */
export function shortCommit(value: string | null | undefined): string | null {
  const commit = (value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/u.test(commit) ? commit.slice(0, 7) : null;
}

/** "0.2.0+1a2b3c4" (semantic versioning's build metadata), or "0.2.0" when the commit is not known. */
export function formatVersion(version: string, commit: string | null | undefined): string {
  const short = shortCommit(commit);
  return short ? `${version}+${short}` : version;
}

/**
 * Where the source of the running version is. An installation that runs a
 * changed Varians names its own repository with SOURCE_URL; otherwise the
 * public repository, at the commit when it is known.
 */
export function sourceUrl(commit: string | null | undefined, override?: string | null): string {
  const own = (override ?? '').trim();
  if (/^https?:\/\/\S+$/u.test(own)) return own;
  const short = shortCommit(commit);
  return short ? `${REPOSITORY_URL}/tree/${short}` : REPOSITORY_URL;
}
