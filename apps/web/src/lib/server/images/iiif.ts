/**
 * IIIF manifests: a library's description of a book as canvases with images.
 * Importing one turns its canvases into pages whose images are shown straight
 * from the library's Image API server (PLAN 4.2). Presentation API 2 and 3 are
 * both read; the output is one plain shape.
 */

import { SafeFetchError, safeFetch } from '../safe-fetch.ts';

export interface IiifCanvas {
  /** The canvas id (its URI). */
  id: string;
  /** The canvas label in the preferred language, or its number when it has none. */
  label: string;
  width: number;
  height: number;
  /** Base URL of the Image API service, without /info.json; null when the canvas has no service. */
  imageService: string | null;
  /** A direct image URL, when the painting body is a plain image resource. */
  imageUrl?: string;
}

export interface IiifManifest {
  label: string;
  version: 2 | 3;
  canvases: IiifCanvas[];
  /** Things the import could not read as expected, for the user to see. */
  warnings: string[];
}

export type ManifestErrorCode = 'invalid' | 'unsupported' | 'fetch' | 'too-large' | 'timeout';

export class ManifestError extends Error {
  constructor(
    readonly code: ManifestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

const PREFERRED_LANGUAGES = ['en', 'none', '@none'];

/**
 * Reads a label in any of the shapes the two API versions use: a string, an
 * array of strings, v2 `{ "@value", "@language" }` objects, or a v3 language
 * map `{ en: ["..."], none: ["..."] }`. English is preferred, then a value
 * without language, then whatever comes first.
 */
export function labelText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return str(value);

  if (Array.isArray(value)) {
    const entries: { text: string; lang: string }[] = [];
    for (const item of value) {
      if (typeof item === 'string' || typeof item === 'number') {
        const text = str(item);
        if (text) entries.push({ text, lang: 'none' });
      } else if (isRecord(item)) {
        const text = str(item['@value'] ?? item.value);
        if (text) entries.push({ text, lang: str(item['@language'] ?? item.language) ?? 'none' });
      }
    }
    return pickByLanguage(entries);
  }

  if (isRecord(value)) {
    if ('@value' in value) return str(value['@value']);
    const entries: { text: string; lang: string }[] = [];
    for (const [lang, texts] of Object.entries(value)) {
      const parts = asArray(texts)
        .map((t) => str(t))
        .filter((t): t is string => t !== null);
      if (parts.length > 0) entries.push({ text: parts.join(', '), lang });
    }
    return pickByLanguage(entries);
  }
  return null;
}

function pickByLanguage(entries: { text: string; lang: string }[]): string | null {
  if (entries.length === 0) return null;
  for (const preferred of PREFERRED_LANGUAGES) {
    const hit = entries.find((e) => e.lang === preferred || e.lang.startsWith(preferred + '-'));
    if (hit) return hit.text;
  }
  return entries[0].text;
}

/** Resolves a possibly relative id against the manifest's URL; returns it unchanged when that fails. */
function resolveUrl(id: string, base: string): string {
  try {
    return new URL(id, base).toString();
  } catch {
    return id;
  }
}

/** Strips a trailing `/info.json` and trailing slashes from an Image API id. */
export function normalizeServiceId(id: string): string {
  return id.replace(/\/info\.json$/i, '').replace(/\/+$/, '');
}

export function imageInfoUrl(service: string): string {
  return `${normalizeServiceId(service)}/info.json`;
}

/** A JPEG of the full image scaled to `width` pixels wide, through the Image API. */
export function thumbnailUrl(service: string, width: number): string {
  const w = Math.max(1, Math.round(width));
  return `${normalizeServiceId(service)}/full/${w},/0/default.jpg`;
}

function looksLikeImageService(service: Json): boolean {
  const type = str(service.type ?? service['@type']) ?? '';
  if (/^ImageService\d?$/i.test(type)) return true;
  const profiles = asArray(service.profile)
    .map((p) => (isRecord(p) ? str(p['@id'] ?? p.id) : str(p)) ?? '')
    .join(' ');
  if (/iiif\.io\/api\/image/i.test(profiles)) return true;
  const context = asArray(service['@context']).map(str).join(' ');
  return /iiif\.io\/api\/image/i.test(context);
}

/** Picks the Image API service from a body's `service` (object or array) and returns its base URL. */
function serviceOf(body: Json | null, base: string): string | null {
  if (!body) return null;
  const services = asArray(body.service).filter(isRecord);
  if (services.length === 0) return null;
  const preferred = services.find(looksLikeImageService) ?? services[0];
  const id = str(preferred.id ?? preferred['@id']);
  return id ? normalizeServiceId(resolveUrl(id, base)) : null;
}

function directImageOf(body: Json | null, base: string): string | undefined {
  if (!body) return undefined;
  const type = str(body.type ?? body['@type']) ?? '';
  const id = str(body.id ?? body['@id']);
  if (!id) return undefined;
  if (/image/i.test(type) || type === '' || /\.(jpe?g|png|tiff?|webp|jp2)$/i.test(id)) {
    return resolveUrl(id, base);
  }
  return undefined;
}

/** v2: the first image annotation's resource, with an `oa:Choice` unwrapped to its default. */
function v2PaintingResource(canvas: Json): Json | null {
  for (const image of asArray(canvas.images)) {
    if (!isRecord(image)) continue;
    let resource = isRecord(image.resource) ? image.resource : null;
    if (resource && str(resource['@type']) === 'oa:Choice') {
      const choice = isRecord(resource.default)
        ? resource.default
        : asArray(resource.item).find(isRecord);
      resource = (choice as Json | undefined) ?? null;
    }
    if (resource) return resource;
  }
  return null;
}

/** v3: the first painting body, with Choice and SpecificResource unwrapped. */
function v3PaintingBody(canvas: Json): Json | null {
  for (const page of asArray(canvas.items)) {
    if (!isRecord(page)) continue;
    for (const annotation of asArray(page.items)) {
      if (!isRecord(annotation)) continue;
      const motivations = asArray(annotation.motivation).map((m) => str(m) ?? '');
      if (motivations.length > 0 && !motivations.some((m) => /painting/i.test(m))) continue;
      for (let body of asArray(annotation.body)) {
        if (!isRecord(body)) continue;
        if (str(body.type) === 'Choice') {
          const first = asArray(body.items).find(isRecord);
          if (!first) continue;
          body = first;
        }
        if (isRecord(body) && str(body.type) === 'SpecificResource' && isRecord(body.source)) {
          body = body.source;
        }
        if (isRecord(body)) return body;
      }
    }
  }
  return null;
}

function canvasDimensions(
  canvas: Json,
  body: Json | null,
  label: string,
  warnings: string[],
): { width: number; height: number } {
  let width = num(canvas.width);
  let height = num(canvas.height);
  if (!width || !height) {
    width = width ?? num(body?.width);
    height = height ?? num(body?.height);
    if (width && height) {
      warnings.push(`Canvas "${label}" has no dimensions; using the image's.`);
    } else {
      warnings.push(`Canvas "${label}" has no dimensions.`);
      width = width ?? 0;
      height = height ?? 0;
    }
  }
  return { width, height };
}

/**
 * Reads a Presentation API 2 or 3 manifest. Throws ManifestError('unsupported')
 * when the document is neither. Canvases without an image are kept (a page
 * exists whether or not it has a photograph) with a warning.
 */
export function parseManifest(json: unknown, manifestUrl: string): IiifManifest {
  if (!isRecord(json)) throw new ManifestError('invalid', 'The manifest is not a JSON object.');
  const warnings: string[] = [];

  const v2Sequences = asArray(json.sequences).filter(isRecord);
  const v3Items = asArray(json.items).filter(isRecord);
  const declaredType = str(json.type ?? json['@type']) ?? '';
  const isCollection = /Collection$/i.test(declaredType);
  if (isCollection) {
    throw new ManifestError('unsupported', 'This is a collection; give the URL of one manifest.');
  }

  let version: 2 | 3;
  let rawCanvases: Json[];
  if (v2Sequences.length > 0) {
    version = 2;
    rawCanvases = asArray(v2Sequences[0].canvases).filter(isRecord);
    if (v2Sequences.length > 1)
      warnings.push('The manifest has several sequences; only the first is used.');
  } else if (v3Items.length > 0 || declaredType === 'Manifest') {
    version = 3;
    rawCanvases = v3Items.filter((item) => str(item.type) === 'Canvas' || item.items !== undefined);
  } else {
    throw new ManifestError('unsupported', 'Not a IIIF Presentation API 2 or 3 manifest.');
  }

  const label = labelText(json.label) ?? (str(json.id ?? json['@id']) || 'Untitled manifest');
  if (!labelText(json.label)) warnings.push('The manifest has no label.');

  const canvases: IiifCanvas[] = rawCanvases.map((canvas, index) => {
    const id = str(canvas.id ?? canvas['@id']) ?? `${manifestUrl}#canvas-${index + 1}`;
    let canvasLabel = labelText(canvas.label);
    if (!canvasLabel) {
      canvasLabel = String(index + 1);
      warnings.push(`Canvas ${index + 1} has no label; numbered instead.`);
    }
    const body = version === 2 ? v2PaintingResource(canvas) : v3PaintingBody(canvas);
    const imageService = serviceOf(body, manifestUrl);
    const imageUrl = directImageOf(body, manifestUrl);
    if (!imageService && !imageUrl) warnings.push(`Canvas "${canvasLabel}" has no image.`);
    const { width, height } = canvasDimensions(canvas, body, canvasLabel, warnings);
    const result: IiifCanvas = {
      id: resolveUrl(id, manifestUrl),
      label: canvasLabel,
      width,
      height,
      imageService,
    };
    if (imageUrl) result.imageUrl = imageUrl;
    return result;
  });

  if (canvases.length === 0) warnings.push('The manifest has no canvases.');
  return { label, version, canvases, warnings };
}

export interface FetchManifestOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** For tests; global fetch by default. */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_MANIFEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MANIFEST_MAX_BYTES = 20 * 1024 * 1024;

async function readCapped(
  response: Response,
  maxBytes: number,
  abort: AbortController,
): Promise<string> {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      abort.abort();
      throw new ManifestError('too-large', `The manifest is larger than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** Fetches a manifest as JSON (not yet parsed into canvases) with a timeout and a size cap. */
export async function fetchManifest(
  url: string,
  options: FetchManifestOptions = {},
): Promise<unknown> {
  const {
    timeoutMs = DEFAULT_MANIFEST_TIMEOUT_MS,
    maxBytes = DEFAULT_MANIFEST_MAX_BYTES,
    fetchImpl = safeFetch as unknown as typeof fetch,
  } = options;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ManifestError('invalid', 'Not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ManifestError('invalid', 'The manifest URL must start with http:// or https://.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/ld+json, application/json;q=0.9, */*;q=0.1' },
    });
    if (!response.ok) {
      throw new ManifestError('fetch', `The server answered ${response.status}.`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new ManifestError('too-large', `The manifest is larger than ${maxBytes} bytes.`);
    }
    const text = await readCapped(response, maxBytes, controller);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ManifestError('invalid', 'The response is not JSON.');
    }
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ManifestError('timeout', `No answer within ${timeoutMs} ms.`);
    }
    if (error instanceof SafeFetchError) throw new ManifestError('invalid', 'This address cannot be fetched from the server.');
    // Network details stay in the log: they would tell a visitor about the server's surroundings.
    console.warn('manifest fetch failed', error);
    throw new ManifestError('fetch', 'The manifest could not be fetched.');
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches and reads a manifest in one step. */
export async function loadManifest(
  url: string,
  options: FetchManifestOptions = {},
): Promise<IiifManifest> {
  return parseManifest(await fetchManifest(url, options), url);
}
