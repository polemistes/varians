/**
 * A document session on the client: the stream the editor shows, the
 * version it rests on, the operations not yet saved, and the save protocol.
 * Framework-agnostic; the page subscribes to its state.
 *
 * Saves are debounced and sent one at a time. A version conflict brings the
 * server's current content and the changesets since our version: pending
 * operations that touch none of the items those changed are replayed on the
 * server's content and sent again; the rest are reported through
 * `onConflict`, and the server's content stands.
 *
 * A save may also succeed and be adjusted: the server put a transcript's
 * pages back in shape after our operations. Its content is then taken up
 * in the same way, with what was typed meanwhile replayed on it.
 */

import { applyOps, conflictingIds, type Changeset, type Op, type Stream } from '@varians/core';

export interface SaveOk {
  ok: true;
  version: number;
  changesetId: string;
  /** The server changed the document after our operations: its content now, and the changesets that did it. */
  adjusted?: { content: Stream; since: Changeset[] };
}

export interface SaveConflict {
  ok: false;
  conflict: true;
  current: { version: number; content: Stream };
  since: Changeset[];
}

export interface SaveFailure {
  ok: false;
  conflict?: false;
  status: number;
  message: string;
}

export type SaveResponse = SaveOk | SaveConflict | SaveFailure;

/** Sends operations against a version; the page supplies it with fetch. */
export type Transport = (body: { fromVersion: number; ops: Op[] }) => Promise<SaveResponse>;

export interface SessionState {
  stream: Stream;
  version: number;
  /** Operations applied locally and not yet saved. */
  pending: number;
  saving: boolean;
  /** The last failure, until the next successful save. */
  error: string | null;
  /** Local changes dropped at a conflict, for the page to report. */
  dropped: Op[];
}

export interface SessionOptions {
  debounceMs?: number;
  onChange?: (state: SessionState) => void;
  onConflict?: (info: { dropped: Op[]; replayed: Op[]; since: Changeset[] }) => void;
  /** The server adjusted the document after a save of ours; `dropped` are later local changes it left no place for. */
  onAdjusted?: (info: { dropped: Op[]; since: Changeset[]; stream: Stream }) => void;
  /** Called with the server's content when the editor must re-render from it. */
  onExternalContent?: (stream: Stream) => void;
}

export class DocumentSession {
  private stream: Stream;
  private version: number;
  private queue: Op[] = [];
  private inFlight: Op[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private error: string | null = null;
  private dropped: Op[] = [];
  private closed = false;

  constructor(
    initial: { content: Stream; version: number },
    private readonly transport: Transport,
    private readonly options: SessionOptions = {},
  ) {
    this.stream = initial.content;
    this.version = initial.version;
  }

  get state(): SessionState {
    return {
      stream: this.stream,
      version: this.version,
      pending: this.queue.length + this.inFlight.length,
      saving: this.saving,
      error: this.error,
      dropped: this.dropped,
    };
  }

  /** The editor applied operations locally; `next` is the stream after them. */
  apply(ops: Op[], next: Stream): void {
    if (ops.length === 0) return;
    this.stream = next;
    this.queue.push(...ops);
    this.notify();
    this.schedule();
  }

  /** Save now, waiting for the result. Resolves when nothing is pending or a failure stopped the saving. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0 && !this.closed) {
      if (this.saving) {
        await this.current;
        continue;
      }
      await this.send();
      if (this.error) return;
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private current: Promise<void> = Promise.resolve();

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send();
    }, this.options.debounceMs ?? 800);
  }

  private async send(): Promise<void> {
    if (this.saving || this.queue.length === 0 || this.closed) return;
    this.saving = true;
    this.inFlight = this.queue;
    this.queue = [];
    this.notify();
    this.current = (async () => {
      let response: SaveResponse;
      try {
        response = await this.transport({ fromVersion: this.version, ops: this.inFlight });
      } catch (error) {
        response = {
          ok: false,
          status: 0,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (response.ok) {
        this.version = response.version;
        this.error = null;
        this.inFlight = [];
        if (response.adjusted) {
          const { content, since } = response.adjusted;
          const { dropped } = this.rebase({ version: response.version, content }, since);
          this.options.onAdjusted?.({ dropped, since, stream: this.stream });
          this.options.onExternalContent?.(this.stream);
        }
      } else if ('conflict' in response && response.conflict) {
        const { dropped, replayed } = this.rebase(response.current, response.since);
        this.options.onConflict?.({ dropped, replayed, since: response.since });
        this.options.onExternalContent?.(this.stream);
      } else {
        // Keep the operations for another try; the page shows the error.
        this.queue = [...this.inFlight, ...this.queue];
        this.inFlight = [];
        this.error = response.message;
      }
      this.saving = false;
      this.notify();
      if (this.queue.length > 0 && !this.error) this.schedule();
    })();
    await this.current;
  }

  /**
   * Take the server's content, and replay on it what is not yet saved and
   * does not overlap with the changes made there; drop what does.
   */
  private rebase(
    current: { version: number; content: Stream },
    since: Changeset[],
  ): { dropped: Op[]; replayed: Op[] } {
    const theirs = since.flatMap((c) => c.ops);
    const mine = [...this.inFlight, ...this.queue];
    this.inFlight = [];
    this.queue = [];
    let stream = current.content;
    const replayed: Op[] = [];
    const dropped: Op[] = [];
    for (const op of mine) {
      if (conflictingIds([op], theirs).length > 0) {
        dropped.push(op);
        continue;
      }
      try {
        stream = applyOps(stream, [op]).stream;
        replayed.push(op);
      } catch {
        dropped.push(op);
      }
    }
    this.stream = stream;
    this.version = current.version;
    this.dropped = dropped;
    this.queue = replayed;
    this.error = null;
    return { dropped, replayed };
  }

  private notify(): void {
    this.options.onChange?.(this.state);
  }
}

/**
 * An operation as it travels: a `set` removes a field by setting it to
 * undefined, which JSON would drop silently; on the wire it is null.
 */
export function wireOp(op: Op): Op {
  if (op.t !== 'set') return op;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(op.fields))
    fields[key] = value === undefined ? null : value;
  return { ...op, fields };
}

/** A transport over fetch against the documents API. */
export function fetchTransport(url: string): Transport {
  return async (body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, ops: body.ops.map(wireOp) }),
    });
    if (response.status === 409) {
      const data = (await response.json()) as {
        current: { version: number; content: Stream };
        since: Changeset[];
      };
      return { ok: false, conflict: true, current: data.current, since: data.since };
    }
    if (!response.ok) {
      let message = response.statusText;
      try {
        const data = (await response.json()) as { message?: string };
        if (data.message) message = data.message;
      } catch {
        // No body.
      }
      return { ok: false, status: response.status, message };
    }
    const data = (await response.json()) as {
      version: number;
      changesetId: string;
      adjusted?: { content: Stream; since: Changeset[] };
    };
    return {
      ok: true,
      version: data.version,
      changesetId: data.changesetId,
      ...(data.adjusted ? { adjusted: data.adjusted } : {}),
    };
  };
}
