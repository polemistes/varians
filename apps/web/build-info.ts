/**
 * What the build knows about itself: the version in package.json and the
 * commit it is built from. The commit comes from VARIANS_COMMIT when set (CI
 * and the Dockerfile set it, since a container build or a release tarball
 * has no .git), otherwise from git, otherwise it is unknown.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function buildVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export function buildCommit(): string {
  const given = process.env.VARIANS_COMMIT?.trim();
  if (given) return given;
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: new URL('.', import.meta.url),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/** The constants vite replaces in the code (declared in src/app.d.ts). */
export function buildDefines(): Record<string, string> {
  return {
    __VARIANS_VERSION__: JSON.stringify(buildVersion()),
    __VARIANS_COMMIT__: JSON.stringify(buildCommit()),
  };
}
