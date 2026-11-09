/**
 * Values mirrored from the schema for the browser: importing @varians/db on
 * the client would pull the database driver in.
 */
import type { ConjectureKind, Witness, WitnessHand } from '@varians/db';
import { registry } from '$lib/strings/registry';

export type WitnessCategory = Witness['category'];

/** What the carrier is; the material and the format are fields of their own. */
export const WITNESS_CATEGORIES = ['manuscript', 'inscription', 'edition', 'indirect', 'other'] as const satisfies readonly WitnessCategory[];

export type WitnessFormat = NonNullable<Witness['format']>;

/** The format of a manuscript. */
export const WITNESS_FORMATS = ['codex', 'roll', 'sheet', 'unknown'] as const satisfies readonly WitnessFormat[];

/**
 * The writing materials offered. The witness's `material` column holds one
 * of these keys, or the free text given under Other; `materialLabel` tells
 * them apart.
 */
export const WITNESS_MATERIALS = [
  'papyrus',
  'parchment',
  'paper',
  'palm-leaf',
  'birch-bark',
  'leather',
  'wood',
  'wax-tablet',
  'ostracon',
  'clay',
  'stone',
  'metal',
  'bone',
  'textile',
  'plaster',
] as const;

export type WitnessMaterial = (typeof WITNESS_MATERIALS)[number];

/** The choice in the material list that opens the free-text field. */
export const MATERIAL_OTHER = 'other';

export function isMaterialKey(value: string): value is WitnessMaterial {
  return (WITNESS_MATERIALS as readonly string[]).includes(value);
}

/** The material as printed: the label of a listed material, or the free text as given. */
export function materialLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return isMaterialKey(value) ? (registry.witness.materials[value] ?? value) : value;
}

/** The two form fields for a stored material: the list's choice, and the free text under Other. */
export function materialFormValues(stored: string | null | undefined): { material: string; materialOther: string } {
  if (!stored) return { material: '', materialOther: '' };
  return isMaterialKey(stored) ? { material: stored, materialOther: '' } : { material: MATERIAL_OTHER, materialOther: stored };
}

export type { WitnessHand };

/** The hand of a correction when no registered hand is named: the scribe of the text, or some other hand. */
export const HAND_SCRIBE = 'scribe';
export const HAND_OTHER = 'other';

/** The hands as a form sends them, as JSON; anything unreadable is no hands. */
export function parseHandsJson(raw: string | null | undefined): WitnessHand[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
      .map((h) => ({
        id: typeof h.id === 'string' ? h.id : '',
        label: typeof h.label === 'string' ? h.label : '',
        description: typeof h.description === 'string' && h.description !== '' ? h.description : null,
        main: h.main === true,
      }));
  } catch {
    return [];
  }
}

/**
 * The name of a hand as a mark or a conspectus names it: a registered hand
 * by its label, the scribe, another hand, or a value as imported.
 */
export function handLabel(value: string | null | undefined, hands: readonly WitnessHand[], words: { scribe: string; other: string }): string | null {
  if (!value) return null;
  if (value === HAND_SCRIBE) return hands.find((h) => h.main)?.label ?? words.scribe;
  if (value === HAND_OTHER) return words.other;
  return hands.find((h) => h.id === value)?.label ?? value;
}

export const CONJECTURE_KINDS = [
  'substitution',
  'deletion',
  'addition',
  'lacuna',
  'supplement',
  'transposition',
] as const satisfies readonly ConjectureKind[];

export type { ConjectureKind };
