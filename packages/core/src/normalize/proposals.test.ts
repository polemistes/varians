import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../ids.ts';
import type { Token } from '../stream/items.ts';
import { applyOps } from '../stream/ops.ts';
import { fromText } from '../stream/text.ts';
import { NormalizationMemory, defaultProfile } from './profile.ts';
import { acceptProposals, confirmToken, proposeNorms, uncheckedTokens } from './proposals.ts';

const grc = defaultProfile('grc');

describe('proposeNorms', () => {
  it('reads each token by its own profile when given one per token', () => {
    const s = fromText('VIRVM VIRVM', { ids: sequentialIds() });
    const lat = defaultProfile('lat');
    const byToken = proposeNorms(s, (token) => (token.id === 't1' ? lat : grc));
    const asLatin = proposeNorms(s, lat)[0]!.norm;
    const asGreek = proposeNorms(s, grc)[0]!.norm;
    expect(asLatin).not.toBe(asGreek);
    expect(byToken.map((p) => p.norm)).toEqual([asLatin, asGreek]);
  });

  it('proposes from the memory first, then from the profile, and skips tokens that need nothing', () => {
    const s = fromText('ΜΗΝΗΝ ΑΕΙΔΕ θεὰ', { ids: sequentialIds() });
    const memory = new NormalizationMemory();
    memory.remember('ΜΗΝΗΝ', 'μῆνιν');
    const proposals = proposeNorms(s, grc, memory);
    expect(proposals).toEqual([
      { tokenId: 't1', form: 'ΜΗΝΗΝ', norm: 'μῆνιν', source: 'memory' },
      { tokenId: 't2', form: 'ΑΕΙΔΕ', norm: 'αειδε', source: 'profile' },
    ]);
    const accepted = applyOps(s, acceptProposals(proposals)).stream;
    expect((accepted.items[0] as Token).norm).toBe('μῆνιν');
    expect((accepted.items[1] as Token).norm).toBe('αειδε');
    expect(proposeNorms(accepted, grc, memory)).toEqual([]);
  });

  it('leaves an unchecked token alone when written and read forms agree under the fold', () => {
    const s = fromText('ΜΗΝΙΝ', { ids: sequentialIds() });
    (s.items[0] as Token).norm = 'μῆνιν';
    (s.items[0] as Token).unchecked = true;
    expect(proposeNorms(s, grc)).toEqual([]);
    expect(uncheckedTokens(s)).toHaveLength(1);
    const memory = new NormalizationMemory();
    const confirmed = applyOps(s, [confirmToken(s.items[0] as Token, memory)]).stream;
    expect((confirmed.items[0] as Token).unchecked).toBeUndefined();
    expect(memory.propose('ΜΗΝΙΝ')).toBe('μῆνιν');
  });
});
