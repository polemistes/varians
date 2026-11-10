/**
 * Calling the form actions of the pages screen from script: a plain post for
 * the menu's actions, and an upload with progress for images. Both answer
 * with SvelteKit's ActionResult, as `enhance` would. The actions live on the
 * pages screen of the witness; `base` names it when the caller is elsewhere
 * (the transcription workbench), and is empty on the screen itself.
 */

import { deserialize } from '$app/forms';
import type { ActionResult } from '@sveltejs/kit';
import { pageStrings } from '$lib/strings/pages';

const HEADERS = { accept: 'application/json', 'x-sveltekit-action': 'true' } as const;

/** The URL of a form action: of the current page, or of the screen `base` names. */
export function actionUrl(action: string, base = ''): string {
  return `${base}?/${action}`;
}

function errorResult(status: number, message: string): ActionResult {
  return { type: 'error', status, error: { message } };
}

/** Reads an action's answer; anything that is not one (a proxy's error page) becomes an error result. */
function read(status: number, text: string): ActionResult {
  try {
    return deserialize(text);
  } catch {
    if (status === 413) return errorResult(status, pageStrings.upload.tooLargeForServer);
    return errorResult(status, pageStrings.errors.generic);
  }
}

/** Posts fields to a form action of the current page, or of the screen `base` names. */
export async function postAction(
  action: string,
  fields: Record<string, string | Blob>,
  base = '',
): Promise<ActionResult> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  try {
    const response = await fetch(actionUrl(action, base), {
      method: 'POST',
      body,
      headers: HEADERS,
    });
    return read(response.status, await response.text());
  } catch {
    return errorResult(0, pageStrings.upload.network);
  }
}

export interface Upload {
  /** Settles with the action's answer; never rejects. */
  result: Promise<ActionResult>;
  abort(): void;
}

/**
 * Posts a multipart body to a form action with XMLHttpRequest, which, unlike
 * fetch, reports how much of the body has been sent. `onprogress` receives
 * fractions from 0 to 1; at 1 the server is still working on the file.
 */
export function uploadToAction(
  action: string,
  body: FormData,
  onprogress: (fraction: number) => void,
  base = '',
): Upload {
  const xhr = new XMLHttpRequest();
  const result = new Promise<ActionResult>((resolve) => {
    xhr.open('POST', actionUrl(action, base));
    for (const [name, value] of Object.entries(HEADERS)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onprogress(event.loaded / event.total);
    };
    xhr.upload.onload = () => onprogress(1);
    xhr.onload = () => resolve(read(xhr.status, xhr.responseText));
    xhr.onerror = () => resolve(errorResult(0, pageStrings.upload.network));
    xhr.onabort = () => resolve(errorResult(0, pageStrings.upload.stopped));
    xhr.send(body);
  });
  return { result, abort: () => xhr.abort() };
}

/** The message of a result that is not a success, for a toast or a line under a file. */
export function failureMessage(result: ActionResult): string {
  if (result.type === 'failure') {
    const data = result.data as
      | { error?: string; errors?: Record<string, string[] | undefined> }
      | undefined;
    const field = data?.errors
      ? Object.values(data.errors).find((list) => list && list.length > 0)?.[0]
      : undefined;
    return data?.error ?? field ?? pageStrings.errors.generic;
  }
  if (result.type === 'error') return result.error?.message ?? pageStrings.errors.generic;
  if (result.type === 'redirect') return pageStrings.errors.signIn;
  return '';
}

/** Megabytes, for limits and file sizes. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
