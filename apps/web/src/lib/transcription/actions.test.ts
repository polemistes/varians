import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '$lib/record/actions';
import { NO_TRANSCRIPTION_RIGHTS, transcriptionActions, type TranscriptionRights } from './actions';

const owner: TranscriptionRights = {
  signedIn: true,
  edit: true,
  publish: true,
  delete: true,
  deleteVersion: false,
};
const administrator: TranscriptionRights = { ...owner, deleteVersion: true };
/** One who edits it through an edition that names it, or a site editor: may not publish or delete. */
const collaborator: TranscriptionRights = {
  signedIn: true,
  edit: true,
  publish: false,
  delete: false,
  deleteVersion: false,
};
const stranger: TranscriptionRights = {
  signedIn: true,
  edit: false,
  publish: false,
  delete: false,
  deleteVersion: false,
};
const visitor = NO_TRANSCRIPTION_RIGHTS;

const transcription = { id: 'T1', latestVersion: 2 };
const draft = { id: 'T1', latestVersion: null };

/** The menu as a list of words: the item ids, a label as `[Label]`, a separator as `|`. */
function shape(menu: MenuEntry[]): string[] {
  return menu.map((entry) =>
    entry.kind === 'separator' ? '|' : entry.kind === 'label' ? `[${entry.label}]` : entry.id,
  );
}

const downloads = ['[Download]', 'tei', 'leiden'];

describe('the menu of a transcript', () => {
  it('has every item in its fixed order for its owner', () => {
    const { menu } = transcriptionActions(transcription, owner, 'workbench');
    expect(shape(menu)).toEqual([
      'settings',
      '|',
      'publish',
      'withdraw',
      '|',
      'copy',
      '|',
      ...downloads,
      '|',
      'delete',
    ]);
    expect(menu.map((m) => ('label' in m ? m.label : null)).filter(Boolean)).toEqual([
      'Settings…',
      'Publish…',
      'Withdraw Version…',
      'Make a Copy…',
      'Download',
      'TEI XML',
      'Leiden+',
      'Delete Transcript…',
    ]);
  });

  it('gives an administrator Delete Version… before Delete Transcript…, whatever versions there are', () => {
    for (const subject of [draft, transcription]) {
      const { menu } = transcriptionActions(subject, administrator, 'list');
      expect(shape(menu).slice(-3)).toEqual(['|', 'delete-version', 'delete']);
      expect(menu.at(-2)).toMatchObject({ label: 'Delete Version…', danger: true });
      expect(menu.at(-2)).not.toHaveProperty('disabled');
    }
    expect(shape(transcriptionActions(transcription, owner, 'list').menu)).not.toContain(
      'delete-version',
    );
  });

  it('offers publishing and withdrawing to the owner only', () => {
    for (const rights of [collaborator, stranger, visitor])
      expect(
        shape(transcriptionActions(transcription, rights, 'workbench').menu).filter((id) =>
          /publish|withdraw/.test(id),
        ),
      ).toEqual([]);
  });

  it('shows Withdraw Version… disabled with its reason while no version stands', () => {
    const withdraw = (subject: typeof draft | typeof transcription) =>
      transcriptionActions(subject, owner, 'workbench').menu.find(
        (m) => m.kind === 'action' && m.id === 'withdraw',
      );
    expect(withdraw(draft)).toMatchObject({ disabled: 'No version to withdraw.' });
    expect(withdraw(transcription)).not.toHaveProperty('disabled');
  });

  it('gives one who may edit it the settings, the copy and the downloads', () => {
    expect(shape(transcriptionActions(transcription, collaborator, 'workbench').menu)).toEqual([
      'settings',
      '|',
      'copy',
      '|',
      ...downloads,
    ]);
  });

  it('gives a reader who is signed in the copy and the downloads in the workbench', () => {
    expect(shape(transcriptionActions(transcription, stranger, 'workbench').menu)).toEqual([
      'copy',
      '|',
      ...downloads,
    ]);
  });

  it('gives a visitor the downloads only', () => {
    expect(shape(transcriptionActions(transcription, visitor, 'workbench').menu)).toEqual(
      downloads,
    );
  });

  it('is the same in a list as in the workbench, for those who may change the transcript', () => {
    for (const rights of [owner, collaborator])
      expect(transcriptionActions(transcription, rights, 'list')).toEqual(
        transcriptionActions(transcription, rights, 'workbench'),
      );
  });

  it('gives those who may not change it nothing in a list', () => {
    for (const rights of [stranger, visitor])
      expect(transcriptionActions(transcription, rights, 'list')).toEqual({
        buttons: [],
        menu: [],
      });
  });

  it('has no buttons: the name leads to the workbench, where it is read and edited', () => {
    for (const place of ['list', 'workbench'] as const)
      expect(transcriptionActions(transcription, owner, place).buttons).toEqual([]);
  });

  it('puts Delete last, after a separator, and marks it', () => {
    const menu = transcriptionActions(transcription, owner, 'workbench').menu;
    expect(menu.at(-2)).toEqual({ kind: 'separator' });
    expect(menu.at(-1)).toMatchObject({ kind: 'action', id: 'delete', danger: true });
  });

  it('links the downloads to the files of the transcript', () => {
    const menu = transcriptionActions(
      { id: 'T 1', latestVersion: null },
      visitor,
      'workbench',
    ).menu;
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'tei', href: '/transcriptions/T%201/tei', file: true }),
    );
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'leiden', href: '/transcriptions/T%201/leiden', file: true }),
    );
  });
});
