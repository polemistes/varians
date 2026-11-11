/**
 * What may be done with a witness, wherever it stands (docs/design.md,
 * section 4): Edit beside its name for those who maintain it, then its menu,
 * in one order everywhere. An item is there only for those who may do it,
 * and one that cannot be done now is shown disabled with its reason.
 */
import { joinGroups, type MenuEntry, type RecordActions } from '$lib/record/actions';
import { recordActions } from '$lib/strings/record-actions';

const t = recordActions.witness;

/** Where the buttons and the menu stand. */
export type WitnessPlace = 'list' | 'page';

/** What the viewer may do with the witness. */
export interface WitnessRights {
  /** Edit its description, pages and images; the maintainers, and site editors. */
  maintain: boolean;
  /** Start a merge: an administrator, or one who maintains it (the page asks for the other entry). */
  merge: boolean;
  /** Delete it: its creator, or an administrator. */
  delete: boolean;
}

export const NO_WITNESS_RIGHTS: WitnessRights = { maintain: false, merge: false, delete: false };

/** The ids of the menu's items that the page does, rather than leads to. */
export type WitnessActionId = 'delete';

/**
 * The buttons and the menu of a witness. In a list they are for those who
 * may change it, and nobody else has any; on the witness's own page the
 * menu is shown to whoever has an item in it.
 *
 * `deletion` is the reason the witness cannot be deleted now, where the page
 * knows it: the item is then shown disabled with it.
 */
export function witnessActions(
  witness: { slug: string },
  rights: WitnessRights,
  place: WitnessPlace,
  options: { name?: string; deletion?: string | null } = {},
): RecordActions {
  if (place === 'list' && !rights.maintain) return { buttons: [], menu: [] };
  const base = `/witnesses/${encodeURIComponent(witness.slug)}`;

  const buttons: RecordActions['buttons'] = [];
  if (rights.maintain)
    buttons.push({
      id: 'edit',
      label: t.edit,
      ...(options.name ? { name: t.editOf(options.name) } : {}),
      href: `${base}/edit`,
    });

  const merging: MenuEntry[] = rights.merge
    ? [{ kind: 'link', id: 'merge', label: t.merge, href: `${base}/merge` }]
    : [];
  const deleting: MenuEntry[] = rights.delete
    ? [
        {
          kind: 'action',
          id: 'delete',
          label: t.delete,
          danger: true,
          ...(options.deletion ? { disabled: options.deletion } : {}),
        },
      ]
    : [];

  return { buttons, menu: joinGroups([merging, deleting]) };
}
