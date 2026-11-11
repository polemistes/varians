/**
 * What may be done with a transcript, wherever it stands (docs/design.md,
 * section 4). A transcript is read where it is edited, in the workbench, so
 * its name leads there and it has no Read and Edit buttons: only the menu,
 * the same in the workbench's header, in the rows of a witness's page and a
 * work's page, on Your Work and on the front page's Continue. An item is
 * there only for those who may do it.
 *
 * There is no publishing item: a transcript is published with the edition
 * that names it, and taken back with it.
 */
import { joinGroups, type MenuEntry, type RecordActions } from '$lib/record/actions';
import { recordActions } from '$lib/strings/record-actions';

const t = recordActions.transcription;

/** Where the menu stands. */
export type TranscriptionPlace = 'list' | 'workbench';

/** What the viewer may do with the transcript. */
export interface TranscriptionRights {
  signedIn: boolean;
  /** Change its text and its settings: the owner, those who edit an edition that names it, site editors. */
  edit: boolean;
  /** Delete it: the owner, or an administrator. */
  delete: boolean;
}

export const NO_TRANSCRIPTION_RIGHTS: TranscriptionRights = {
  signedIn: false,
  edit: false,
  delete: false,
};

/** The ids of the menu's items that the page does, rather than leads to. */
export type TranscriptionActionId = 'settings' | 'copy' | 'delete';

/** The addresses of the downloads. */
export function transcriptionDownloads(id: string): { tei: string; leiden: string } {
  const base = `/transcriptions/${encodeURIComponent(id)}`;
  return { tei: `${base}/tei`, leiden: `${base}/leiden` };
}

/**
 * The menu of a transcript. In a list it is for those who may change the
 * transcript; in the workbench, which is its own page, it is there for
 * everyone, with what they may do: for a reader, copying and the downloads.
 */
export function transcriptionActions(
  transcription: { id: string },
  rights: TranscriptionRights,
  place: TranscriptionPlace,
): RecordActions {
  if (place === 'list' && !rights.edit && !rights.delete) return { buttons: [], menu: [] };

  const downloads = transcriptionDownloads(transcription.id);
  const settings: MenuEntry[] = rights.edit
    ? [{ kind: 'action', id: 'settings', label: t.settings }]
    : [];
  const copying: MenuEntry[] = rights.signedIn
    ? [{ kind: 'action', id: 'copy', label: t.copy }]
    : [];
  const downloading: MenuEntry[] = [
    { kind: 'label', label: t.download },
    { kind: 'link', id: 'tei', label: t.tei, href: downloads.tei, file: true },
    { kind: 'link', id: 'leiden', label: t.leiden, href: downloads.leiden, file: true },
  ];
  const deleting: MenuEntry[] = rights.delete
    ? [{ kind: 'action', id: 'delete', label: t.delete, danger: true }]
    : [];

  return { buttons: [], menu: joinGroups([settings, copying, downloading, deleting]) };
}
