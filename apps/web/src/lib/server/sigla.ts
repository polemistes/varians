/**
 * The conspectus as the server reads it: each siglum with the further states
 * of its witness that are collated under sigla of their own. Bases and
 * archives written before states carry the state before correction as
 * `originalSiglum`; they are read into the same shape.
 */
import type { CollationState } from '@varians/core';
import type { SiglumState, WitnessHand } from '@varians/db';
import { HAND_SCRIBE } from '../registry/witness.ts';

export interface ConspectusEntry {
  siglum: string;
  witnessId: string;
  transcriptionId: string | null;
  states: SiglumState[];
  variantSiglum: string | null;
}

export interface StoredSiglum {
  siglum: string;
  witnessId: string;
  transcriptionId: string | null;
  states?: SiglumState[] | null;
  originalSiglum?: string | null;
  variantSiglum?: string | null;
}

export function normalizeSiglum(row: StoredSiglum): ConspectusEntry {
  const states = row.states ? [...row.states] : [];
  if (row.originalSiglum && !states.some((s) => s.kind === 'original')) states.unshift({ kind: 'original', siglum: row.originalSiglum });
  return { siglum: row.siglum, witnessId: row.witnessId, transcriptionId: row.transcriptionId, states, variantSiglum: row.variantSiglum ?? null };
}

/** The id of the collation text of a state: the transcription's id and the state's place in the list. */
export function stateTextId(transcriptionId: string, index: number): string {
  return `${transcriptionId}:s${index}`;
}

/** The values a state's hand matches on the marks: the hand's id, and 'scribe' when it is the main hand, or the other way round. */
export function handAliases(hand: string, hands: readonly WitnessHand[]): string[] {
  const main = hands.find((h) => h.main);
  if (hand === HAND_SCRIBE) return main ? [HAND_SCRIBE, main.id] : [HAND_SCRIBE];
  return main && main.id === hand ? [hand, HAND_SCRIBE] : [hand];
}

/** The state as the core reads it. */
export function collationStateOf(state: SiglumState, hands: readonly WitnessHand[]): CollationState {
  switch (state.kind) {
    case 'original':
      return 'original';
    case 'stage':
      return { kind: 'stage', upTo: state.stage };
    case 'hand':
      return { kind: 'hand', hands: handAliases(state.hand, hands) };
  }
}
