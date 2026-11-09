/**
 * Attachments for the first field of a dialog. Bits UI focuses the first
 * tabbable element (the close button) unless focus is already inside, so a
 * field that takes focus as it appears keeps it.
 */

/** Focuses the element as it appears. */
export function autofocus(node: HTMLElement): void {
  node.focus();
}

/** Focuses a text field as it appears and selects what it holds, for renaming. */
export function autoselect(node: HTMLElement): void {
  node.focus();
  if (node instanceof HTMLInputElement) node.select();
}
