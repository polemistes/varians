/**
 * The history endpoints as the panel calls them. A failed request throws
 * HistoryRequestError with its status, so that the panel can tell a
 * conflict (409) from a failure; a refused undo comes back as its result.
 */
import type {
  DocumentAtVersion,
  DocumentHistory,
  DocumentKind,
  MomentResult,
  ReviewChanges,
  ReviewState,
  RevertResult,
  UndoResult,
} from '$lib/history/types';

export class HistoryRequestError extends Error {
  constructor(
    /** 0 when the server could not be reached. */
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'HistoryRequestError';
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new HistoryRequestError(0, 'offline', null);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String(body.message)
        : response.statusText;
    throw new HistoryRequestError(response.status, message, body);
  }
  return body as T;
}

function post<T>(url: string, data: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function isRefusedUndo(body: unknown): body is Extract<UndoResult, { ok: false }> {
  return (
    !!body && typeof body === 'object' && 'ok' in body && body.ok === false && 'conflicts' in body
  );
}

export interface HistoryApi {
  history(): Promise<DocumentHistory>;
  at(version: number, since?: number): Promise<DocumentAtVersion>;
  nameMoment(version: number, name: string): Promise<MomentResult>;
  revert(version: number, currentVersion?: number): Promise<RevertResult>;
  undo(changesetId: string, options?: { force?: boolean; reviewed?: boolean }): Promise<UndoResult>;
  review(): Promise<ReviewChanges>;
  accept(changesetIds: string[]): Promise<ReviewState>;
  reviewFrom(version: number): Promise<ReviewState>;
}

export function historyApi(kind: DocumentKind, documentId: string): HistoryApi {
  const base = `/api/documents/${kind}/${encodeURIComponent(documentId)}`;
  return {
    history: () => request(`${base}/history`),
    at: (version, since) =>
      request(`${base}/at/${version}${since === undefined ? '' : `?since=${since}`}`),
    nameMoment: (version, name) => post(`${base}/moments`, { version, name }),
    revert: (version, currentVersion) => post(`${base}/revert`, { version, currentVersion }),
    undo: async (changesetId, options = {}) => {
      try {
        return await post<UndoResult>(`${base}/undo`, { changesetId, ...options });
      } catch (cause) {
        if (
          cause instanceof HistoryRequestError &&
          cause.status === 409 &&
          isRefusedUndo(cause.body)
        )
          return cause.body;
        throw cause;
      }
    },
    review: () => request(`${base}/review`),
    accept: (changesetIds) => post(`${base}/review`, { accept: changesetIds }),
    reviewFrom: (version) => post(`${base}/review`, { from: version }),
  };
}
