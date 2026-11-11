/**
 * What may be done with an edition, wherever it stands (docs/design.md,
 * section 4): the buttons Read and Edit beside its name, then its menu, in
 * one order everywhere. An item is there only for those who may do it, and
 * one that leads to the page one is on is left out.
 */
import { joinGroups, type MenuEntry, type RecordActions } from '$lib/record/actions';
import { recordActions } from '$lib/strings/record-actions';

const t = recordActions.edition;

/** Where the buttons and the menu stand. */
export type EditionPlace = 'list' | 'reader' | 'editor' | 'settings';

/** What the viewer may do with the edition. */
export interface EditionRights {
  signedIn: boolean;
  edit: boolean;
  publish: boolean;
  delete: boolean;
}

export interface EditionSubject {
  slug: string;
  published: boolean;
}

/** The ids of the menu's items that the page does, rather than leads to. */
export type EditionActionId = 'publish' | 'unpublish' | 'copy' | 'delete';

/** The addresses of the downloads; in the reader, of the state shown. */
export interface EditionDownloads {
  tei: string;
  package: string;
}

export const NO_RIGHTS: EditionRights = {
  signedIn: false,
  edit: false,
  publish: false,
  delete: false,
};

export function editionDownloads(slug: string): EditionDownloads {
  const base = `/editions/${encodeURIComponent(slug)}`;
  return { tei: `${base}.tei.xml`, package: `${base}/package.zip` };
}

/**
 * The buttons and the menu of an edition. In a list they are for those who
 * may edit it, and nobody else has any: the name is the way to read. On the
 * edition's own pages the menu is there for everyone, with what they may do.
 */
export function editionActions(
  edition: EditionSubject,
  rights: EditionRights,
  place: EditionPlace,
  options: { downloads?: EditionDownloads; name?: string } = {},
): RecordActions {
  if (place === 'list' && !rights.edit) return { buttons: [], menu: [] };
  const base = `/editions/${encodeURIComponent(edition.slug)}`;
  const name = options.name;

  const buttons: RecordActions['buttons'] = [];
  if (rights.edit && place !== 'reader')
    buttons.push({
      id: 'read',
      label: t.read,
      ...(name ? { name: t.readOf(name) } : {}),
      // From the editor, Read shows what is being edited: the draft, which a published edition previews.
      href: place === 'editor' && edition.published ? `${base}?draft=1` : base,
    });
  if (rights.edit && place !== 'editor')
    buttons.push({
      id: 'edit',
      label: t.edit,
      ...(name ? { name: t.editOf(name) } : {}),
      href: `${base}/edit`,
    });

  const downloads = options.downloads ?? editionDownloads(edition.slug);
  const settings: MenuEntry[] =
    rights.edit && place !== 'settings'
      ? [{ kind: 'link', id: 'settings', label: t.settings, href: `${base}/settings` }]
      : [];
  const publishing: MenuEntry[] = [];
  if (rights.publish) {
    publishing.push({ kind: 'action', id: 'publish', label: t.publish });
    if (edition.published) publishing.push({ kind: 'action', id: 'unpublish', label: t.unpublish });
  }
  const copying: MenuEntry[] =
    rights.signedIn && (rights.edit || edition.published)
      ? [{ kind: 'action', id: 'copy', label: t.copy }]
      : [];
  const downloading: MenuEntry[] = [
    { kind: 'label', label: t.download },
    { kind: 'link', id: 'tei', label: t.tei, href: downloads.tei, file: true },
    { kind: 'link', id: 'package', label: t.package, href: downloads.package, file: true },
  ];
  const deleting: MenuEntry[] = rights.delete
    ? [{ kind: 'action', id: 'delete', label: t.delete, danger: true }]
    : [];

  return { buttons, menu: joinGroups([settings, publishing, copying, downloading, deleting]) };
}
