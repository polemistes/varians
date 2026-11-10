import { describe, expect, it } from 'vitest';
import { draftsOf, settleGroups, type ConspectusEntry } from './groups';

const entry = (witnessId: string, siglum: string, more: Partial<ConspectusEntry> = {}) => ({
  witnessId,
  siglum,
  ...more,
});
const conspectus = [entry('wR', 'R'), entry('wG', 'G'), entry('wV', 'V'), entry('wH', 'H')];

describe('draftsOf', () => {
  it('names the witnesses behind the members, and drops a siglum the conspectus lacks', () => {
    expect(
      draftsOf(
        [
          { siglum: 'p', members: ['V', 'H'], note: 'consensus codicum VH' },
          { siglum: 'q', members: ['R', 'Z'] },
        ],
        conspectus,
      ),
    ).toEqual([
      { siglum: 'p', note: 'consensus codicum VH', witnessIds: ['wV', 'wH'] },
      { siglum: 'q', witnessIds: ['wR'] },
    ]);
    expect(draftsOf(undefined, conspectus)).toEqual([]);
  });
});

describe('settleGroups', () => {
  const p = { siglum: 'p', witnessIds: ['wH', 'wV'] };

  it('stores a group by the sigla of its members, in the order of the conspectus', () => {
    expect(settleGroups([{ ...p, note: ' VH ' }], conspectus)).toEqual({
      groups: [{ siglum: 'p', members: ['V', 'H'], note: 'VH' }],
    });
    expect(settleGroups([{ ...p, note: '  ' }], conspectus)).toEqual({
      groups: [{ siglum: 'p', members: ['V', 'H'] }],
    });
  });

  it('follows a witness whose siglum is changed', () => {
    const renamed = [entry('wR', 'R'), entry('wG', 'G'), entry('wV', 'V2'), entry('wH', 'H')];
    expect(settleGroups([p], renamed)).toEqual({
      groups: [{ siglum: 'p', members: ['V2', 'H'] }],
    });
  });

  it('drops a member that left the conspectus, and a group left with fewer than two', () => {
    const three = { siglum: 'q', witnessIds: ['wR', 'wG', 'wV'] };
    const without = (...ids: string[]) => conspectus.filter((e) => !ids.includes(e.witnessId));
    expect(settleGroups([three, p], without('wG'))).toEqual({
      groups: [
        { siglum: 'q', members: ['R', 'V'] },
        { siglum: 'p', members: ['V', 'H'] },
      ],
    });
    expect(settleGroups([three, p], without('wG', 'wV'))).toEqual({ groups: [] });
  });

  it('refuses a siglum that is empty, or that a witness, a state, a variant siglum or another group has', () => {
    expect(settleGroups([{ ...p, siglum: ' ' }], conspectus)).toEqual({
      problem: { kind: 'siglum' },
    });
    expect(settleGroups([{ ...p, siglum: 'G' }], conspectus)).toEqual({
      problem: { kind: 'taken', siglum: 'G' },
    });
    const rich = [
      entry('wR', 'R', { states: [{ siglum: 'R¹' }], variantSiglum: 'R v.l.' }),
      ...conspectus.slice(1),
    ];
    expect(settleGroups([{ ...p, siglum: 'R¹' }], rich)).toEqual({
      problem: { kind: 'taken', siglum: 'R¹' },
    });
    expect(settleGroups([{ ...p, siglum: 'R v.l.' }], rich)).toEqual({
      problem: { kind: 'taken', siglum: 'R v.l.' },
    });
    expect(settleGroups([p, { siglum: 'p', witnessIds: ['wR', 'wG'] }], conspectus)).toEqual({
      problem: { kind: 'taken', siglum: 'p' },
    });
    // Sigla differ in case.
    expect(settleGroups([{ ...p, siglum: 'r' }], conspectus)).toMatchObject({ groups: [{}] });
  });

  it('does not let a group that goes block another with its siglum', () => {
    const gone = { siglum: 'x', witnessIds: ['wZ', 'wR'] };
    expect(settleGroups([gone, { siglum: 'x', witnessIds: ['wV', 'wH'] }], conspectus)).toEqual({
      groups: [{ siglum: 'x', members: ['V', 'H'] }],
    });
  });

  it('refuses, for groups just made, one with fewer than two witnesses as it stands', () => {
    const one = { siglum: 'p', witnessIds: ['wV'] };
    expect(settleGroups([one], conspectus, { strict: true })).toEqual({
      problem: { kind: 'too-few', siglum: 'p' },
    });
    expect(settleGroups([one], conspectus)).toEqual({ groups: [] });
    // Two witnesses as asked, one of them gone: the group goes, it is not refused.
    expect(
      settleGroups(
        [p],
        conspectus.filter((e) => e.witnessId !== 'wH'),
        { strict: true },
      ),
    ).toEqual({ groups: [] });
    expect(settleGroups([{ ...one, siglum: '' }], conspectus, { strict: true })).toEqual({
      problem: { kind: 'siglum' },
    });
  });
});
