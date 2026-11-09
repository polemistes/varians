/**
 * The hands a correction or a noted variant may name: the witness's
 * registered hands, the scribe of the text and an unidentified other hand.
 */
import { HAND_OTHER, HAND_SCRIBE, handLabel, type WitnessHand } from '$lib/registry/witness';

export interface HandWords {
  notKnown: string;
  scribe: string;
  other: string;
}

export interface HandOption {
  value: string;
  label: string;
}

/**
 * The choices for a hand: nothing (not known), the scribe (the main hand by
 * id when one is registered), the other registered hands, another hand, and
 * the current value when it is none of these (a value as imported).
 */
export function handOptions(hands: readonly WitnessHand[], words: HandWords, current?: string): HandOption[] {
  const main = hands.find((h) => h.main);
  const out: HandOption[] = [{ value: '', label: words.notKnown }];
  if (main) out.push({ value: main.id, label: `${main.label} (${words.scribe.toLowerCase()})` });
  else out.push({ value: HAND_SCRIBE, label: words.scribe });
  for (const hand of hands) if (!hand.main) out.push({ value: hand.id, label: hand.label });
  out.push({ value: HAND_OTHER, label: words.other });
  if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: current });
  return out;
}

/** The value to store for a chosen option: the scribe's id when registered, else the choice itself. */
export function handValue(choice: string, hands: readonly WitnessHand[]): string | undefined {
  if (!choice) return undefined;
  if (choice === HAND_SCRIBE) return hands.find((h) => h.main)?.id ?? HAND_SCRIBE;
  return choice;
}

export { handLabel };
