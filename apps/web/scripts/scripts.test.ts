import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appDir, parseEnv, redactUrl } from './env.ts';
import { DownloadError, checksumGiven, download, sha256OfFile } from './lexicon/download.ts';

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

describe('a download of the lexicon build', () => {
  const sha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'; // of "abc"
  const abc = (async () => new Response('abc')) as unknown as typeof fetch;

  it('is written to its destination, made as needed, and checked against the SHA-256 given', async () => {
    const dest = path.join(dir, 'sources', 'checked.xml');
    await download('https://example.org/checked.xml', dest, { fetch: abc, sha256: sha.toUpperCase() });
    expect(await readFile(dest, 'utf8')).toBe('abc');
    expect(await sha256OfFile(dest)).toBe(sha);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('leaves nothing behind when the checksum does not match', async () => {
    const dest = path.join(dir, 'wrong.xml');
    await expect(download('https://example.org/wrong.xml', dest, { fetch: abc, sha256: '0'.repeat(64) })).rejects.toThrow(/SHA-256/u);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(() => checksumGiven('xyz')).toThrow(/64 hexadecimal/u);
  });

  it('refuses a failed download, plain http without a checksum, and other schemes', async () => {
    const notFound = (async () => new Response('missing', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    await expect(download('https://example.org/missing', path.join(dir, 'missing'), { fetch: notFound })).rejects.toThrow(/404/u);
    await expect(download('https://example.org/missing', path.join(dir, 'missing'), { fetch: notFound })).rejects.toBeInstanceOf(DownloadError);
    await expect(download('http://example.org/x.xml', path.join(dir, 'x.xml'))).rejects.toThrow(/https/u);
    await expect(download('file:///etc/passwd', path.join(dir, 'passwd'))).rejects.toThrow(/https/u);
  });

  it('refuses a redirect away from https unless a checksum vouches for the file', async () => {
    const redirected = (async () => ({ ok: true, status: 200, statusText: 'OK', url: 'http://mirror.example.org/x.xml', body: new Response('abc').body })) as unknown as typeof fetch;
    await expect(download('https://example.org/x.xml', path.join(dir, 'r1.xml'), { fetch: redirected })).rejects.toThrow(/redirected/u);
    await download('https://example.org/x.xml', path.join(dir, 'r2.xml'), { fetch: redirected, sha256: sha });
    expect(existsSync(path.join(dir, 'r2.xml'))).toBe(true);
  });
});
