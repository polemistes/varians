import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '$lib/record/actions';
import { NO_TRANSCRIPTION_RIGHTS, transcriptionActions, type TranscriptionRights } from './actions';

const owner: TranscriptionRights = { signedIn: true, edit: true, delete: true };
/** One who edits it through an edition that names it, or a site editor: may not delete. */
const collaborator: TranscriptionRights = { signedIn: true, edit: true, delete: false };
const stranger: TranscriptionRights = { signedIn: true, edit: false, delete: false };
const visitor = NO_TRANSCRIPTION_RIGHTS;

const transcription = { id: 'T1' };

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
    expect(shape(menu)).toEqual(['settings', '|', 'copy', '|', ...downloads, '|', 'delete']);
    expect(menu.map((m) => ('label' in m ? m.label : null)).filter(Boolean)).toEqual([
      'Settings…',
      'Make a Copy…',
      'Download',
      'TEI XML',
      'Leiden+',
      'Delete Transcript…',
    ]);
  });

  it('has no group for publishing: a transcript is published with its edition', () => {
    for (const rights of [owner, collaborator, stranger, visitor])
      expect(
        shape(transcriptionActions(transcription, rights, 'workbench').menu).filter((id) =>
          /publish/i.test(id),
        ),
      ).toEqual([]);
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
    const menu = transcriptionActions({ id: 'T 1' }, visitor, 'workbench').menu;
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'tei', href: '/transcriptions/T%201/tei', file: true }),
    );
    expect(menu).toContainEqual(
      expect.objectContaining({ id: 'leiden', href: '/transcriptions/T%201/leiden', file: true }),
    );
  });
});
