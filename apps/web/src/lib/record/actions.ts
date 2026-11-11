/**
 * The shape of what may be done with a record, for any kind: the buttons
 * beside its name and the items of its ⋯ menu, in their order. Each kind
 * has a pure function that gives these from the record's state and the
 * viewer's rights (lib/edition/actions.ts for an edition); the component
 * RecordActions renders them.
 */

/** A button beside the name: a page to go to. */
export interface ActionButton {
  id: string;
  label: string;
  /** The accessible name where it differs from the label (in a list, with the record's name). */
  name?: string;
  href: string;
}

export type MenuEntry =
  /** A page, or with `file` a download the browser fetches. */
  | { kind: 'link'; id: string; label: string; href: string; file?: boolean }
  /** Done by the page that renders the menu, given the id: a window, or an action at once. */
  | {
      kind: 'action';
      id: string;
      label: string;
      danger?: boolean;
      /** Why it cannot be done now: the item is shown disabled with this reason. */
      disabled?: string;
    }
  /** A heading over the items that follow it. */
  | { kind: 'label'; label: string }
  | { kind: 'separator' };

export interface RecordActions {
  buttons: ActionButton[];
  menu: MenuEntry[];
}

/** The groups of a menu, empty ones left out, with a separator between each two. */
export function joinGroups(groups: MenuEntry[][]): MenuEntry[] {
  const menu: MenuEntry[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    if (menu.length) menu.push({ kind: 'separator' });
    menu.push(...group);
  }
  return menu;
}
