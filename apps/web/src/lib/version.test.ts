import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PACKAGE_VERSION,
  REPOSITORY_URL,
  VERSION,
  formatVersion,
  shortCommit,
  sourceUrl,
} from './version';

describe('the version', () => {
  it('is the package version with the short commit as build metadata', () => {
    expect(formatVersion('0.2.0', '1a2b3c4d5e6f')).toBe('0.2.0+1a2b3c4');
    expect(formatVersion('0.2.0', '1A2B3C4')).toBe('0.2.0+1a2b3c4');
  });

  it('is the package version alone when the commit is unknown or not a commit', () => {
    expect(formatVersion('0.2.0', '')).toBe('0.2.0');
    expect(formatVersion('0.2.0', null)).toBe('0.2.0');
    expect(formatVersion('0.2.0', 'main')).toBe('0.2.0');
    expect(formatVersion('0.2.0', 'abc')).toBe('0.2.0');
    expect(formatVersion('0.2.0', '1a2b3c4; rm -rf /')).toBe('0.2.0');
  });

  it('accepts only hexadecimal commits of 7 to 40 characters', () => {
    expect(shortCommit(' 0123456789abcdef0123456789abcdef01234567 ')).toBe('0123456');
    expect(shortCommit('0123456789abcdef0123456789abcdef012345678')).toBeNull();
    expect(shortCommit('<script>')).toBeNull();
  });

  it('is fixed at build from apps/web/package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(VERSION.startsWith(pkg.version)).toBe(true);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(\+[0-9a-f]{7})?$/u);
  });
});

describe('the source of the running version', () => {
  it('is the public repository at the commit', () => {
    expect(sourceUrl('1a2b3c4d')).toBe(`${REPOSITORY_URL}/tree/1a2b3c4`);
    expect(sourceUrl(null)).toBe(REPOSITORY_URL);
  });

  it('is the installation’s own repository when SOURCE_URL names one', () => {
    expect(sourceUrl('1a2b3c4', 'https://example.org/our-varians')).toBe(
      'https://example.org/our-varians',
    );
  });

  it('ignores a SOURCE_URL that is not a web address', () => {
    expect(sourceUrl('1a2b3c4', 'javascript:alert(1)')).toBe(`${REPOSITORY_URL}/tree/1a2b3c4`);
    expect(sourceUrl(null, '  ')).toBe(REPOSITORY_URL);
  });
});
