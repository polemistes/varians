import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SafeFetchError, isPublicAddress, readTextCapped, safeFetch } from './safe-fetch.ts';

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/redirect-out') {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      response.end();
    } else if (request.url === '/redirect-in') {
      response.writeHead(302, { location: '/hello' });
      response.end();
    } else if (request.url === '/big') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(5000));
    } else {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('hello');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, shared and reserved addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('allows public addresses', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(isPublicAddress(address), address).toBe(true);
  });
});

describe('safeFetch', () => {
  it('refuses the server’s own addresses, by number and by name', async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch(`http://localhost:${port}/`)).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch(`http://localhost.:${port}/`)).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('checks every redirect again', async () => {
    const allowLoopback = (address: string) => address === '127.0.0.1';
    const followed = await safeFetch(`http://127.0.0.1:${port}/redirect-in`, { allow: allowLoopback });
    expect(await followed.text()).toBe('hello');
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect-out`, { allow: allowLoopback })).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('caps what it reads', async () => {
    const response = await safeFetch(`http://127.0.0.1:${port}/big`, { allow: (a) => a === '127.0.0.1' });
    await expect(readTextCapped(response, 1000)).rejects.toBeInstanceOf(RangeError);
  });
});
