/**
 * Packages (Data Format 2 section 9): one or more
 * archives in a BagIt bag (RFC 8493) with RO-Crate 1.2 metadata, zipped.
 * A package is made for a scope (a work, an edition, a transcription, a set
 * of these, or the whole installation) as one person may see it, and carries
 * what its records depend on. Reading a package checks its checksums before
 * anything is read.
 */

import { licenceInfo, orcidUrl } from '@varians/core';
import {
  editionSigla,
  editions,
  moments,
  transcriptions,
  works,
  type Database,
  type MomentBasis,
} from '@varians/db';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { and, desc, eq } from 'drizzle-orm';
import { canViewWork, grantsFor, type Actor } from '../authz.ts';
import { workBySlug } from '../registry.ts';
import { dataLicence, siteName } from '../settings.ts';
import { FORMAT_BASE, FORMAT_VERSION, writeArchive, type ArchiveFilter } from './archive.ts';
import { worksOfDocument } from './commits.ts';
import { viewerFilter } from './viewer.ts';

export type PackageScope =
  | { kind: 'work'; workId: string }
  | { kind: 'edition'; editionId: string }
  | { kind: 'transcription'; transcriptionId: string }
  | { kind: 'installation' };

export interface PackageOptions {
  storageRoot?: string;
  /** The installation's address, for the TEI's prefixes and the bag's identifiers. */
  origin?: string;
  /** The top folder's name; made from the scope when not given. */
  name?: string;
  /** The software, for bag-info.txt. */
  agent?: string;
}

export interface BuiltPackage {
  file: string;
  name: string;
  cleanup(): Promise<void>;
}

/** Either of two filters: what one scope or another takes. */
function union(a: ArchiveFilter, b: ArchiveFilter): ArchiveFilter {
  return {
    transcription: (r) => a.transcription(r) || b.transcription(r),
    edition: (r) => a.edition(r) || b.edition(r),
    editionWorking: (r) => a.editionWorking(r) || b.editionWorking(r),
    conjecture: (r) => a.conjecture(r) || b.conjecture(r),
    reported: (r) => a.reported(r) || b.reported(r),
    transcriptionVersion: (r) => a.transcriptionVersion?.(r) ?? b.transcriptionVersion?.(r) ?? null,
  };
}

const NOTHING = () => false;

/** The filters of a set of scopes, one per work, for a viewer. */
export async function scopeFilters(
  db: Database,
  viewer: Actor | null,
  scopes: PackageScope[],
): Promise<Map<string, ArchiveFilter>> {
  const out = new Map<string, ArchiveFilter>();
  const add = (workId: string, filter: ArchiveFilter) =>
    out.set(workId, out.has(workId) ? union(out.get(workId)!, filter) : filter);
  const grants = await grantsFor(db, viewer);
  const visibleWork = async (workId: string) => {
    const [row] = await db.select({ slug: works.slug }).from(works).where(eq(works.id, workId));
    const record = row ? await workBySlug(db, row.slug) : null;
    if (!record || !canViewWork(viewer, record.work, record.maintainerIds, grants)) return null;
    return record;
  };
  for (const scope of scopes) {
    if (scope.kind === 'work' || scope.kind === 'installation') {
      const ids =
        scope.kind === 'work'
          ? [scope.workId]
          : (await db.select({ id: works.id }).from(works)).map((w) => w.id);
      for (const workId of ids) {
        const record = await visibleWork(workId);
        if (record) add(workId, await viewerFilter(db, viewer, record.maintainerIds));
      }
      continue;
    }
    if (scope.kind === 'edition') {
      const [edition] = await db.select().from(editions).where(eq(editions.id, scope.editionId));
      if (!edition) continue;
      const record = await visibleWork(edition.workId);
      if (!record) continue;
      const base = await viewerFilter(db, viewer, record.maintainerIds);
      if (!base.edition(edition)) continue;
      const working = base.editionWorking(edition);
      // The transcriptions the conspectus names: as it stands for those who edit the edition, as published for others, at the versions the apparatus was collated against.
      let named: Set<string>;
      let versions: Record<string, number> = {};
      if (working || edition.publishedVersion === null) {
        named = new Set(
          (
            await db
              .select({ id: editionSigla.transcriptionId })
              .from(editionSigla)
              .where(eq(editionSigla.editionId, edition.id))
          )
            .map((s) => s.id)
            .filter((id): id is string => id !== null),
        );
      } else {
        const [published] = await db
          .select({ basis: moments.basis })
          .from(moments)
          .where(
            and(
              eq(moments.documentKind, 'edition'),
              eq(moments.documentId, edition.id),
              eq(moments.kind, 'published'),
              eq(moments.version, edition.publishedVersion),
            ),
          )
          .orderBy(desc(moments.at))
          .limit(1);
        const basis = published?.basis as MomentBasis | null | undefined;
        named = new Set(
          (basis?.sigla ?? []).map((s) => s.transcriptionId).filter((id): id is string => !!id),
        );
        versions = basis?.versions ?? {};
      }
      add(edition.workId, {
        transcription: (r) => named.has(r.id) && base.transcription(r),
        edition: (r) => r.id === edition.id && base.edition(r),
        editionWorking: base.editionWorking,
        conjecture: base.conjecture,
        reported: base.reported,
        transcriptionVersion: (r) => (working ? null : (versions[r.id] ?? null)),
      });
      continue;
    }
    // A transcription, with its works' own files, its witness and pages.
    const [t] = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.id, scope.transcriptionId));
    if (!t) continue;
    for (const workId of await worksOfDocument(db, 'transcription', t.id)) {
      const record = await visibleWork(workId);
      if (!record) continue;
      const base = await viewerFilter(db, viewer, record.maintainerIds);
      if (!base.transcription(t)) continue;
      add(workId, {
        transcription: (r) => r.id === t.id && base.transcription(r),
        edition: NOTHING,
        editionWorking: NOTHING,
        conjecture: NOTHING,
        reported: NOTHING,
      });
    }
  }
  return out;
}

async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await filesUnder(dir, rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

const FORMATS: Record<string, string> = {
  '.json': 'application/json',
  '.ndjson': 'application/x-ndjson',
  '.xml': 'application/tei+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.tsv': 'text/tab-separated-values',
  '.bib': 'application/x-bibtex',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
};

/** The RO-Crate 1.2 metadata of the payload (Data Format 2, 9.2). */
async function roCrate(
  dataDir: string,
  name: string,
  origin: string | undefined,
): Promise<unknown> {
  const files = (await filesUnder(dataDir)).filter((f) => f !== 'ro-crate-metadata.json');
  const parts: Record<string, unknown>[] = [];
  const people = new Map<string, Record<string, unknown>>();
  const extra: Record<string, unknown>[] = [];
  for (const file of files) {
    const entity: Record<string, unknown> = {
      '@id': file,
      '@type': 'File',
      encodingFormat: FORMATS[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    };
    if (file.endsWith('.json')) {
      try {
        const data = JSON.parse(await readFile(path.join(dataDir, file), 'utf8')) as Record<
          string,
          unknown
        >;
        if (typeof data.$schema === 'string') entity.conformsTo = { '@id': data.$schema };
        if (file.endsWith('/persons.json')) {
          for (const p of (data.persons as { id: string; name: string; orcid: string | null }[]) ??
            []) {
            const id = p.orcid
              ? orcidUrl(p.orcid)
              : origin
                ? `${origin}/id/${p.id}`
                : `#person-${p.id}`;
            people.set(id, { '@id': id, '@type': 'Person', name: p.name });
          }
        }
        if (file.endsWith('/pages.json')) {
          // Images not included are named by their source, with their rights.
          for (const p of (data.pages as {
            id: string;
            image: {
              file: string | null;
              iiif: string | null;
              rights: string | null;
              attribution: string | null;
              source: string | null;
              kind: string;
            } | null;
          }[]) ?? []) {
            if (!p.image || p.image.file) continue;
            const source = p.image.iiif ? `${p.image.iiif}/full/max/0/default.jpg` : p.image.source;
            extra.push({
              '@id': source ?? `#image-${p.id}`,
              '@type': 'ImageObject',
              ...(source ? { contentUrl: source } : {}),
              ...(p.image.rights ? { license: { '@id': p.image.rights } } : {}),
              ...(p.image.attribution ? { creditText: p.image.attribution } : {}),
            });
          }
        }
      } catch {
        // A file that is not JSON is described by its type alone.
      }
    }
    parts.push(entity);
  }
  const licence = licenceInfo(dataLicence())!;
  return {
    '@context': 'https://w3id.org/ro/crate/1.2/context',
    '@graph': [
      {
        '@id': 'ro-crate-metadata.json',
        '@type': 'CreativeWork',
        conformsTo: { '@id': 'https://w3id.org/ro/crate/1.2' },
        about: { '@id': './' },
      },
      {
        '@id': './',
        '@type': 'Dataset',
        name,
        datePublished: new Date().toISOString().slice(0, 10),
        publisher: siteName(),
        license: { '@id': licence.url },
        conformsTo: { '@id': `${FORMAT_BASE}package` },
        creator: [...people.keys()].map((id) => ({ '@id': id })),
        hasPart: parts.map((p) => ({ '@id': p['@id'] })),
      },
      { '@id': licence.url, '@type': 'CreativeWork', name: licence.name },
      ...people.values(),
      ...parts,
      ...extra,
    ],
  };
}

/** Write a bag: data/ holds the payload; the tag files describe and check it. */
async function writeBag(bagDir: string, info: Record<string, string>): Promise<void> {
  const data = path.join(bagDir, 'data');
  const payload = await filesUnder(data);
  const manifest: string[] = [];
  let bytes = 0;
  for (const file of payload) {
    manifest.push(`${await sha256(path.join(data, file))}  data/${file}`);
    bytes += (await stat(path.join(data, file))).size;
  }
  await writeFile(
    path.join(bagDir, 'bagit.txt'),
    'BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n',
    'utf8',
  );
  const fields = { ...info, 'Payload-Oxum': `${bytes}.${payload.length}` };
  await writeFile(
    path.join(bagDir, 'bag-info.txt'),
    Object.entries(fields)
      .map(([k, v]) => `${k}: ${v.replace(/\s*\n\s*/g, ' ')}`)
      .join('\n') + '\n',
    'utf8',
  );
  await writeFile(path.join(bagDir, 'manifest-sha256.txt'), manifest.join('\n') + '\n', 'utf8');
  const tags: string[] = [];
  for (const tag of ['bagit.txt', 'bag-info.txt', 'manifest-sha256.txt'])
    tags.push(`${await sha256(path.join(bagDir, tag))}  ${tag}`);
  await writeFile(path.join(bagDir, 'tagmanifest-sha256.txt'), tags.join('\n') + '\n', 'utf8');
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'package'
  );
}

/** A package of the scopes as the viewer may see them, as a zip file in a temporary directory. Throws when the viewer may see none of it. */
export async function buildPackage(
  db: Database,
  viewer: Actor | null,
  scopes: PackageScope[],
  options: PackageOptions = {},
): Promise<BuiltPackage> {
  const filters = await scopeFilters(db, viewer, scopes);
  if (filters.size === 0) throw new Error('nothing to package');
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'varians-package-'));
  const cleanup = () => rm(tmp, { recursive: true, force: true });
  try {
    const name = slug(options.name ?? (await packageName(db, scopes)));
    const bagDir = path.join(tmp, name);
    const data = path.join(bagDir, 'data');
    await mkdir(data, { recursive: true });
    for (const [workId, only] of filters) {
      await writeArchive(db, workId, data, {
        only,
        ...(options.storageRoot ? { storageRoot: options.storageRoot } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
      });
    }
    await writeFile(
      path.join(data, 'ro-crate-metadata.json'),
      JSON.stringify(await roCrate(data, name, options.origin), null, 2) + '\n',
      'utf8',
    );
    const single = scopes.length === 1 ? scopes[0]! : null;
    const recordId =
      single?.kind === 'work'
        ? single.workId
        : single?.kind === 'edition'
          ? single.editionId
          : single?.kind === 'transcription'
            ? single.transcriptionId
            : null;
    await writeBag(bagDir, {
      'Source-Organization': siteName(),
      'Bagging-Date': new Date().toISOString().slice(0, 10),
      ...(recordId
        ? {
            'External-Identifier': options.origin
              ? `${options.origin.replace(/\/+$/u, '')}/id/${recordId}`
              : recordId,
          }
        : {}),
      'Bag-Software-Agent': options.agent ?? 'Varians',
      'Varians-Format-Version': String(FORMAT_VERSION),
    });
    const file = path.join(tmp, `${name}.zip`);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const out = createWriteStream(file);
    const done = pipeline(archive, out);
    archive.directory(bagDir, name);
    await archive.finalize();
    await done;
    return { file, name, cleanup };
  } catch (cause) {
    await cleanup();
    throw cause;
  }
}

/** The top folder's name: what the package holds. */
async function packageName(db: Database, scopes: PackageScope[]): Promise<string> {
  if (scopes.length !== 1) return `varians-${new Date().toISOString().slice(0, 10)}`;
  const scope = scopes[0]!;
  if (scope.kind === 'installation')
    return `${slug(siteName())}-${new Date().toISOString().slice(0, 10)}`;
  if (scope.kind === 'work')
    return slug(
      (await db.select({ slug: works.slug }).from(works).where(eq(works.id, scope.workId)))[0]
        ?.slug ?? 'work',
    );
  if (scope.kind === 'edition')
    return slug(
      (
        await db
          .select({ slug: editions.slug })
          .from(editions)
          .where(eq(editions.id, scope.editionId))
      )[0]?.slug ?? 'edition',
    );
  const [t] = await db
    .select({ name: transcriptions.name, id: transcriptions.id })
    .from(transcriptions)
    .where(eq(transcriptions.id, scope.transcriptionId));
  return t ? `${slug(t.name)}-${t.id.slice(-6).toLowerCase()}` : 'transcription';
}

// Reading

export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageError';
  }
}

export interface ExtractLimits {
  maxEntries: number;
  maxBytes: number;
}

const DEFAULT_LIMITS: ExtractLimits = { maxEntries: 200_000, maxBytes: 4 * 1024 * 1024 * 1024 };

/**
 * Unpack a zip into a directory, refusing what could escape it: absolute
 * names, `..`, links, and more entries or bytes than the limits allow.
 */
export async function extractZip(
  zipFile: string,
  dest: string,
  limits: ExtractLimits = DEFAULT_LIMITS,
): Promise<void> {
  const unreadable = (e: unknown) =>
    new PackageError(`the package cannot be read: ${e instanceof Error ? e.message : String(e)}`);
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      zipFile,
      { lazyEntries: true, autoClose: true, strictFileNames: false, validateEntrySizes: true },
      (e, z) => (e || !z ? reject(unreadable(e ?? 'not a zip')) : resolve(z)),
    ),
  );
  const root = path.resolve(dest);
  let entries = 0;
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (message: string) => {
      zip.close();
      reject(new PackageError(message));
    };
    zip.on('error', (e) => reject(e instanceof PackageError ? e : unreadable(e)));
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      entries++;
      if (entries > limits.maxEntries) return fail('the package has too many files');
      const name = entry.fileName.replace(/\\/g, '/');
      if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..'))
        return fail(`the package names a file outside itself: ${name}`);
      // Unix mode in the upper half of the external attributes: links are refused.
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode === 0o120000) return fail(`the package holds a link: ${name}`);
      const target = path.resolve(root, name);
      if (target !== root && !target.startsWith(root + path.sep))
        return fail(`the package names a file outside itself: ${name}`);
      if (name.endsWith('/')) {
        void mkdir(target, { recursive: true }).then(() => zip.readEntry(), reject);
        return;
      }
      bytes += entry.uncompressedSize;
      if (bytes > limits.maxBytes) return fail('the package is too large');
      zip.openReadStream(entry, (e, stream) => {
        if (e || !stream) return reject(e ?? new Error('no stream'));
        void mkdir(path.dirname(target), { recursive: true })
          .then(() => pipeline(stream, createWriteStream(target)))
          .then(() => zip.readEntry(), reject);
      });
    });
    zip.readEntry();
  });
}

export interface OpenedPackage {
  /** The work directories to import. */
  workDirs: string[];
  /** Whether it was a bag whose checksums were verified. */
  bag: boolean;
  info: Record<string, string>;
}

function parseTagFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([^:]+):\s*(.*)$/u.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** Verify a bag's manifest: every payload file listed, every listed file present with its checksum. */
async function verifyBag(bagDir: string): Promise<void> {
  if (!existsSync(path.join(bagDir, 'bagit.txt'))) throw new PackageError('bagit.txt is missing');
  const manifestFile = path.join(bagDir, 'manifest-sha256.txt');
  if (!existsSync(manifestFile)) throw new PackageError('the package has no SHA-256 manifest');
  const listed = new Map<string, string>();
  for (const line of (await readFile(manifestFile, 'utf8')).split('\n')) {
    const m = /^([0-9a-f]{64})\s+(.+)$/iu.exec(line.trim());
    if (m) listed.set(m[2]!.replace(/^\*/, ''), m[1]!.toLowerCase());
  }
  const payload = (await filesUnder(path.join(bagDir, 'data'))).map((f) => `data/${f}`);
  for (const file of payload)
    if (!listed.has(file)) throw new PackageError(`${file} is not in the manifest`);
  for (const [file, hash] of listed) {
    const full = path.join(bagDir, file);
    if (!full.startsWith(path.join(bagDir, 'data') + path.sep) || !existsSync(full))
      throw new PackageError(`${file} is in the manifest but not in the package`);
    if ((await sha256(full)) !== hash)
      throw new PackageError(`${file} does not match its checksum`);
  }
  const tagManifest = path.join(bagDir, 'tagmanifest-sha256.txt');
  if (existsSync(tagManifest)) {
    for (const line of (await readFile(tagManifest, 'utf8')).split('\n')) {
      const m = /^([0-9a-f]{64})\s+(.+)$/iu.exec(line.trim());
      if (!m) continue;
      const file = path.join(bagDir, m[2]!);
      if (
        !file.startsWith(bagDir + path.sep) ||
        !existsSync(file) ||
        (await sha256(file)) !== m[1]!.toLowerCase()
      )
        throw new PackageError(`${m[2]} does not match its checksum`);
    }
  }
}

async function workDirsIn(dir: string): Promise<string[]> {
  if (existsSync(path.join(dir, 'work.json'))) return [dir];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(path.join(dir, entry.name, 'work.json')))
      out.push(path.join(dir, entry.name));
  }
  return out.sort();
}

/**
 * Find what a directory holds: a bag (checked), a bare archive, or a folder
 * of archives; looking one folder down for a zip's single top folder.
 */
export async function openPackage(dir: string): Promise<OpenedPackage> {
  let root = dir;
  const entries = (await readdir(dir, { withFileTypes: true })).filter(
    (e) => !e.name.startsWith('.') && e.name !== '__MACOSX',
  );
  if (
    entries.length === 1 &&
    entries[0]!.isDirectory() &&
    !existsSync(path.join(dir, 'work.json')) &&
    !existsSync(path.join(dir, 'bagit.txt'))
  )
    root = path.join(dir, entries[0]!.name);
  if (existsSync(path.join(root, 'bagit.txt'))) {
    await verifyBag(root);
    const info = existsSync(path.join(root, 'bag-info.txt'))
      ? parseTagFile(await readFile(path.join(root, 'bag-info.txt'), 'utf8'))
      : {};
    return { workDirs: await workDirsIn(path.join(root, 'data')), bag: true, info };
  }
  return { workDirs: await workDirsIn(root), bag: false, info: {} };
}

/** Unpack a zip into a new temporary directory and open what it holds; the caller removes `dir`. */
export async function openPackageZip(
  zipFile: string,
  limits?: ExtractLimits,
): Promise<OpenedPackage & { dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'varians-import-'));
  try {
    await extractZip(zipFile, dir, limits);
    return { ...(await openPackage(dir)), dir };
  } catch (cause) {
    await rm(dir, { recursive: true, force: true });
    throw cause;
  }
}
