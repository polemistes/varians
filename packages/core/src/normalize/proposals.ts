/**
 * Read-form proposals for a stream: what the profile and the normalization
 * memory suggest for tokens whose read form is unchecked or missing, and the
 * operations that accept them.
 */

import type { Op } from '../stream/ops.ts';
import { isToken, readForm, type Id, type Stream, type Token } from '../stream/items.ts';
import { agreeUnderFold, proposeReadForm, type NormalizationMemory, type NormalizationProfile } from './profile.ts';

export interface Proposal {
  tokenId: Id;
  form: string;
  /** The read form proposed. */
  norm: string;
  /** Where the proposal comes from. */
  source: 'memory' | 'profile';
}

/**
 * The profile to read a token by: one for the whole stream, or one per
 * token (a transcription running through works of several languages reads
 * each stretch by its own work's profile).
 */
export type ProfileFor = NormalizationProfile | ((token: Token) => NormalizationProfile);

export function profileOf(profiles: ProfileFor, token: Token): NormalizationProfile {
  return typeof profiles === 'function' ? profiles(token) : profiles;
}

/**
 * Proposals for every token whose read form is unchecked, or absent while
 * the profile or the memory would read it otherwise. The memory wins over
 * the profile; a token whose written and read forms already agree under the
 * fold gets no proposal.
 */
export function proposeNorms(stream: Stream, profiles: ProfileFor, memory?: NormalizationMemory): Proposal[] {
  const out: Proposal[] = [];
  for (const item of stream.items) {
    if (!isToken(item)) continue;
    const profile = profileOf(profiles, item);
    if (item.norm !== undefined && !item.unchecked) continue;
    const remembered = memory?.propose(item.form);
    const proposed = remembered ?? proposeReadForm(item.form, item.marks, profile);
    if (proposed === undefined) continue;
    if (proposed === readForm(item) && !item.unchecked) continue;
    if (item.norm !== undefined && item.unchecked && agreeUnderFold(item.form, item.norm, profile)) continue;
    out.push({ tokenId: item.id, form: item.form, norm: proposed, source: remembered !== undefined ? 'memory' : 'profile' });
  }
  return out;
}

/** The operations that accept proposals: set the read form and clear the check mark. */
export function acceptProposals(proposals: Proposal[]): Op[] {
  return proposals.map((p) => ({
    t: 'set' as const,
    id: p.tokenId,
    fields: { norm: p.norm === p.form ? undefined : p.norm, unchecked: undefined },
  }));
}

/** Tokens whose written form changed under a read form and still wait for the editor. */
export function uncheckedTokens(stream: Stream): Token[] {
  return stream.items.filter((i): i is Token => isToken(i) && i.unchecked === true);
}

/** Confirm a token's read form as it stands: clears the check mark and tells the memory. */
export function confirmToken(token: Token, memory?: NormalizationMemory): Op {
  if (memory && token.norm !== undefined && token.norm !== token.form) memory.remember(token.form, token.norm);
  return { t: 'set', id: token.id, fields: { unchecked: undefined } };
}
