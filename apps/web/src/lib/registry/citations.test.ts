import { describe, expect, it } from 'vitest';
import { citationsPayload, citedText, draftsOf } from './citations';
import { parseCitations } from './forms';

const west = {
  itemId: 'b1',
  label: 'West 1998',
  prenote: 'cf.',
  postnote: '45',
  text: 'cf. West 1998, 45',
};
const allen = {
  itemId: 'b2',
  label: 'Allen 1931',
  prenote: null,
  postnote: null,
  text: 'Allen 1931',
};

describe('citations in the registry forms', () => {
  it('fills the picker from what a record cites', () => {
    expect(draftsOf([west, allen])).toEqual([
      { itemId: 'b1', label: 'West 1998', prenote: 'cf.', postnote: '45' },
      { itemId: 'b2', label: 'Allen 1931', prenote: '', postnote: '' },
    ]);
    expect(draftsOf(undefined)).toEqual([]);
  });

  it('sends the drafts as the field the actions read', () => {
    const payload = citationsPayload(draftsOf([west, allen]));
    expect(JSON.parse(payload)).toEqual([
      { itemId: 'b1', prenote: 'cf.', postnote: '45' },
      { itemId: 'b2', prenote: null, postnote: null },
    ]);
    const data = new FormData();
    data.set('citations', payload);
    expect(parseCitations(data)).toEqual({ ok: true, data: JSON.parse(payload) });
  });

  it('prints what a record cites', () => {
    expect(citedText([west, allen])).toBe('cf. West 1998, 45; Allen 1931');
    expect(citedText([])).toBe('');
  });
});
