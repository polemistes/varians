import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appDir, parseEnv, redactUrl } from './env.ts';
import { LexiconSourceError, lexiconSource, sha256OfFile } from './lexicon-source.ts';

const dir = await mkdtemp(path.join(tmpdir(), 'varians-scripts-test-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('settings files', () => {
  it('are read as KEY=value lines, with quotes and comments', () => {
    const text = [
      '# a comment',
      'DATABASE_URL=postgres://varians@/varians?host=/run/postgresql',
      'MAIL_FROM="Varians <noreply@example.org>"',
      "SITE_NAME='Editions of Antiquity'",
      'export ORIGIN=https://example.org',
      'BACKUP_KEEP=14 # two weeks',
      'not a setting',
      'EMPTY=',
    ].join('\n');
    expect(parseEnv(text)).toEqual({
      DATABASE_URL: 'postgres://varians@/varians?host=/run/postgresql',
      MAIL_FROM: 'Varians <noreply@example.org>',
      SITE_NAME: 'Editions of Antiquity',
      ORIGIN: 'https://example.org',
      BACKUP_KEEP: '14',
      EMPTY: '',
    });
  });

  it('are found in the app directory, from the source and from the bundle', () => {
    const app = appDir(new URL('./env.ts', import.meta.url).href);
    expect(existsSync(path.join(app, 'package.json'))).toBe(true);
    expect(path.basename(app)).toBe('web');
  });

  it('never print a password', () => {
    expect(redactUrl('postgres://varians:s3cret@db:5432/varians')).toBe('postgres://varians@db:5432/varians');
    expect(redactUrl('postgresql://varians@/varians?host=/run/postgresql')).toBe('postgresql://varians@/varians?host=/run/postgresql');
  });
});

describe('the source of a lexicon', () => {
  it('is a file that exists', async () => {
    const file = path.join(dir, 'lexicon.sqlite');
    await writeFile(file, 'not really sqlite');
    const source = await lexiconSource(file);
    expect(source.file).toBe(file);
    await source.cleanup();
    expect(existsSync(file)).toBe(true);
    await expect(lexiconSource(path.join(dir, 'missing.sqlite'))).rejects.toBeInstanceOf(LexiconSourceError);
  });

  it('is checked against the SHA-256 given', async () => {
    const file = path.join(dir, 'checked.sqlite');
    await writeFile(file, 'abc');
    const sha = await sha256OfFile(file);
    expect(sha).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect((await lexiconSource(file, { sha256: sha.toUpperCase() })).file).toBe(file);
    await expect(lexiconSource(file, { sha256: '0'.repeat(64) })).rejects.toThrow(/SHA-256/u);
    await expect(lexiconSource(file, { sha256: 'xyz' })).rejects.toThrow(/64 hexadecimal/u);
  });

  it('is downloaded from an https address to a temporary file, removed afterwards', async () => {
    const fake = (async () => new Response('downloaded bytes')) as unknown as typeof fetch;
    const source = await lexiconSource('https://example.org/lexicon.sqlite', { fetch: fake });
    expect(existsSync(source.file)).toBe(true);
    expect(await sha256OfFile(source.file)).toBe(await (async () => {
      const f = path.join(dir, 'same');
      await writeFile(f, 'downloaded bytes');
      return sha256OfFile(f);
    })());
    await source.cleanup();
    expect(existsSync(source.file)).toBe(false);
  });

  it('refuses a failed download, plain http without a checksum, and other schemes', async () => {
    const notFound = (async () => new Response('missing', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    await expect(lexiconSource('https://example.org/missing', { fetch: notFound })).rejects.toThrow(/404/u);
    await expect(lexiconSource('http://example.org/lexicon.sqlite')).rejects.toThrow(/https/u);
    await expect(lexiconSource('file:///etc/passwd')).rejects.toThrow(/https/u);
  });
});
