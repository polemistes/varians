/**
 * What may be done with a work, wherever it stands (docs/design.md, section
 * 4): Edit beside its name for those who maintain it, then its menu, in one
 * order everywhere. An item is there only for those who may do it, and one
 * that cannot be done now is shown disabled with its reason.
 */
import { joinGroups, type MenuEntry, type RecordActions } from '$lib/record/actions';
import { recordActions } from '$lib/strings/record-actions';

const t = recordActions.work;

/** Where the buttons and the menu stand. */
export type WorkPlace = 'list' | 'page';

/** What the viewer may do with the work. */
export interface WorkRights {
  /** Edit its details; the maintainers, and site editors. */
  maintain: boolean;
  /** Start a merge: an administrator, or one who maintains it (the page asks for the other entry). */
  merge: boolean;
  /** Delete it: its creator, or an administrator. */
  delete: boolean;
  /** The server's own archive is for administrators. */
  administrator: boolean;
}

export const NO_WORK_RIGHTS: WorkRights = {
  maintain: false,
  merge: false,
  delete: false,
  administrator: false,
};

/** The ids of the menu's items that the page does, rather than leads to. */
export type WorkActionId = 'delete';

/**
 * The buttons and the menu of a work. In a list they are for those who may
 * change it, and nobody else has any: the name is the way to read. On the
 * work's own page the menu is there for everyone, with what they may do:
 * for a reader, the package.
 *
 * `deletion` is the reason the work cannot be deleted now, where the page
 * knows it: the item is then shown disabled with it.
 */
export function workActions(
  work: { slug: string },
  rights: WorkRights,
  place: WorkPlace,
  options: { name?: string; deletion?: string | null } = {},
): RecordActions {
  if (place === 'list' && !rights.maintain) return { buttons: [], menu: [] };
  const base = `/works/${encodeURIComponent(work.slug)}`;

  const buttons: RecordActions['buttons'] = [];
  if (rights.maintain)
    buttons.push({
      id: 'edit',
      label: t.edit,
      ...(options.name ? { name: t.editOf(options.name) } : {}),
      href: `${base}/edit`,
    });

  const settings: MenuEntry[] = rights.maintain
    ? [{ kind: 'link', id: 'remotes', label: t.remotes, href: `${base}/remotes` }]
    : [];
  const downloading: MenuEntry[] = [
    { kind: 'label', label: t.download },
    { kind: 'link', id: 'package', label: t.package, href: `${base}/package.zip`, file: true },
    ...(rights.administrator
      ? [
          {
            kind: 'link' as const,
            id: 'archive',
            label: t.archive,
            href: `${base}/archive.zip`,
            file: true,
          },
        ]
      : []),
  ];
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

  return { buttons, menu: joinGroups([settings, downloading, merging, deleting]) };
}
