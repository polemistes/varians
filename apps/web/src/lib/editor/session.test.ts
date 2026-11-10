import { describe, expect, it } from 'vitest';
import { applyOps, fromText, sequentialIds, toText, type Op, type Stream } from '@varians/core';
import { DocumentSession, type SaveResponse, type Transport } from './session.ts';

function fakeServer(initial: Stream) {
  let content = initial;
  let version = 0;
  const log: { fromVersion: number; ops: Op[] }[] = [];
  const transport: Transport = async (body) => {
    log.push(body);
    if (body.fromVersion !== version) {
      return { ok: false, conflict: true, current: { version, content }, since: [] };
    }
    content = applyOps(content, body.ops).stream;
    version++;
    return { ok: true, version, changesetId: `c${version}` } satisfies SaveResponse;
  };
  return {
    transport,
    log,
    get content() {
      return content;
    },
    get version() {
      return version;
    },
    /** Another user's save. */
    elsewhere(ops: Op[]) {
      content = applyOps(content, ops).stream;
      version++;
      return { version, ops };
    },
  };
}

describe('DocumentSession', () => {
  it('batches local operations and saves them against the version', async () => {
    const initial = fromText('a b c', { ids: sequentialIds() });
    const server = fakeServer(initial);
    const session = new DocumentSession({ content: initial, version: 0 }, server.transport, {
      debounceMs: 5,
    });
    const ops1: Op[] = [{ t: 'set', id: 't1', fields: { form: 'A' } }];
    session.apply(ops1, applyOps(initial, ops1).stream);
    const ops2: Op[] = [{ t: 'set', id: 't2', fields: { form: 'B' } }];
    session.apply(ops2, applyOps(session.state.stream, ops2).stream);
    expect(session.state.pending).toBe(2);
    await session.flush();
    expect(session.state.pending).toBe(0);
    expect(session.state.version).toBe(1);
    expect(server.log).toHaveLength(1);
    expect(server.log[0]!.ops).toHaveLength(2);
    expect(toText(server.content)).toBe('A B c');
  });

  it('replays non-overlapping edits after a conflict and drops the overlapping ones', async () => {
    const initial = fromText('a b c', { ids: sequentialIds() });
    const server = fakeServer(initial);
    let conflicts = 0;
    const session = new DocumentSession(
      { content: initial, version: 0 },
      async (body) => {
        const response = await server.transport(body);
        if (!response.ok && 'conflict' in response && response.conflict) {
          return {
            ...response,
            since: [
              {
                id: 'x',
                documentId: 'd',
                version: 1,
                userId: 'u',
                at: new Date().toISOString(),
                ops: other.ops,
                reverse: [],
              },
            ],
          };
        }
        return response;
      },
      {
        debounceMs: 5,
        onConflict: () => conflicts++,
      },
    );
    // Someone else changes t1 first.
    const other = server.elsewhere([{ t: 'set', id: 't1', fields: { form: 'Z' } }]);
    const mine: Op[] = [
      { t: 'set', id: 't1', fields: { form: 'A' } },
      { t: 'set', id: 't3', fields: { form: 'C' } },
    ];
    session.apply(mine, applyOps(initial, mine).stream);
    await session.flush();
    expect(conflicts).toBe(1);
    expect(session.state.dropped).toEqual([{ t: 'set', id: 't1', fields: { form: 'A' } }]);
    expect(toText(server.content)).toBe('Z b C');
    expect(session.state.version).toBe(server.version);
    expect(toText(session.state.stream)).toBe('Z b C');
  });

  it('keeps operations and reports an error when the server fails', async () => {
    const initial = fromText('a', { ids: sequentialIds() });
    let fail = true;
    const server = fakeServer(initial);
    const session = new DocumentSession(
      { content: initial, version: 0 },
      async (body) => (fail ? { ok: false, status: 500, message: 'down' } : server.transport(body)),
      { debounceMs: 5 },
    );
    const ops: Op[] = [{ t: 'set', id: 't1', fields: { form: 'A' } }];
    session.apply(ops, applyOps(initial, ops).stream);
    await session.flush();
    expect(session.state.error).toBe('down');
    expect(session.state.pending).toBe(1);
    fail = false;
    await session.flush();
    expect(session.state.error).toBeNull();
    expect(session.state.pending).toBe(0);
    expect(toText(server.content)).toBe('A');
  });
});

describe('wireOp', () => {
  it('sends a removed field as null', async () => {
    const { wireOp } = await import('./session.ts');
    expect(
      JSON.parse(
        JSON.stringify(wireOp({ t: 'set', id: 'a', fields: { norm: undefined, form: 'x' } })),
      ),
    ).toEqual({ t: 'set', id: 'a', fields: { norm: null, form: 'x' } });
    expect(wireOp({ t: 'delete', ids: ['a'] })).toEqual({ t: 'delete', ids: ['a'] });
  });
});
