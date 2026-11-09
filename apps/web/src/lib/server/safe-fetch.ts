/**
 * Fetching an address a user gave (a TEI file, a IIIF manifest) without
 * letting them reach the server's own network: only http and https, every
 * address the name resolves to must be a public one, checked when the
 * connection is made (so a name cannot resolve to something else later),
 * and every redirect is checked again. The answer is a standard Response.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';

export class SafeFetchError extends Error {
  constructor(
    readonly code: 'protocol' | 'address' | 'redirects' | 'redirect',
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

const MAX_REDIRECTS = 5;

function ipv4Parts(address: string): number[] {
  return address.split('.').map(Number);
}

/** Whether an IP address is on the public internet: not loopback, private, link-local, shared, reserved or multicast. */
export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0, c = 0] = ipv4Parts(address);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // shared address space
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower.startsWith('::ffff:') || lower.startsWith('::')) return false; // mapped or compatible forms
    if (lower.startsWith('64:ff9b:')) return false; // NAT64 can reach private IPv4
    if (lower.startsWith('2001:db8')) return false;
    const first = Number.parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local
    if ((first & 0xffc0) === 0xfe80) return false; // link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    return true;
  }
  return false;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** A lookup that refuses names resolving to any address that is not public. */
function guardedLookup(allow: (address: string) => boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '');
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0 || list.some((a) => !allow(a.address))) {
        return callback(new SafeFetchError('address', 'This address cannot be fetched from the server.'), '');
      }
      if (options.all) callback(null, list);
      else callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

export interface SafeFetchInit {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** POST with a body: redirects are then not followed. GET by default. */
  method?: 'GET' | 'POST';
  body?: Buffer;
  /** Which addresses may be reached; the public internet by default. For tests. */
  allow?: (address: string) => boolean;
}

function requestOnce(url: URL, init: SafeFetchInit, allow: (address: string) => boolean): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: init.method ?? 'GET',
        headers: { 'user-agent': 'Varians', ...(init.headers ?? {}), 'accept-encoding': 'identity', ...(init.body ? { 'content-length': String(init.body.length) } : {}) },
        lookup: guardedLookup(allow) as unknown as typeof dns.lookup,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      resolve,
    );
    request.on('error', (error) => reject(error instanceof SafeFetchError ? error : (error as { cause?: unknown }).cause instanceof SafeFetchError ? (error as { cause: SafeFetchError }).cause : error));
    request.end(init.body);
  });
}

/** Like fetch, for an address a user gave: GET only, public addresses only, redirects followed and checked. */
export async function safeFetch(input: string | URL, init: SafeFetchInit = {}): Promise<Response> {
  const allow = init.allow ?? isPublicAddress;
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SafeFetchError('protocol', 'Only http and https addresses can be fetched.');
    const host = url.hostname.replace(/^\[|\]$/gu, '');
    // An address given as a number is connected to without a lookup: check it here.
    if (net.isIP(host) && !allow(host)) throw new SafeFetchError('address', 'This address cannot be fetched from the server.');
    const response = await requestOnce(url, init, allow);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && location) {
      response.resume();
      if (init.method === 'POST') throw new SafeFetchError('redirect', 'The other installation answered with a redirect.');
      const next = new URL(location, url);
      // Credentials are for the origin they were given for, not for where it sends us.
      if (next.origin !== url.origin && init.headers) {
        const { authorization: _a, Authorization: _b, ...rest } = init.headers;
        void _a;
        void _b;
        init = { ...init, headers: rest };
      }
      url = next;
      continue;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(name, v);
      else if (value !== undefined) headers.set(name, value);
    }
    const empty = status === 204 || status === 205 || status === 304;
    if (empty) response.resume();
    return new Response(empty ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>), {
      status: status < 200 || status > 599 ? 502 : status,
      statusText: response.statusMessage ?? '',
      headers,
    });
  }
  throw new SafeFetchError('redirects', 'Too many redirects.');
}

/** The body of a response as text, refused beyond a size. */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError(`larger than ${maxBytes} bytes`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError(`larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
