/**
 * The rights statements an image may carry, as the forms offer
 * them: the listed statements by their labels, after an empty choice.
 */

import { IMAGE_RIGHTS, rightsStatement } from '@varians/core';
import type { SelectOption } from '$lib/components/ui';

export function rightsOptions(empty: string): SelectOption[] {
  return [{ value: '', label: empty }, ...IMAGE_RIGHTS.map((r) => ({ value: r.uri, label: r.label }))];
}

/** The label of a listed statement, or null. */
export function rightsLabel(uri: string | null | undefined): string | null {
  return rightsStatement(uri)?.label ?? null;
}

/** Whether an image under the statement is copied into archives and downloads; true while none is chosen. */
export function rightsCopyable(uri: string | null | undefined): boolean {
  const statement = rightsStatement(uri);
  return statement ? statement.copyable : true;
}
