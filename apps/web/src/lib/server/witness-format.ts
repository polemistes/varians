import type { ExportHand } from '@varians/core';
import type { WitnessHand } from '@varians/db';
/** A witness's format as TEI names it on objectDesc; nothing when it is not a manuscript or the format is not known. */
export function teiForm(witness: {
  category: string;
  format: string | null;
}): 'codex' | 'scroll' | 'leaf' | undefined {
  if (witness.category !== 'manuscript') return undefined;
  return witness.format === 'codex'
    ? 'codex'
    : witness.format === 'roll'
      ? 'scroll'
      : witness.format === 'sheet'
        ? 'leaf'
        : undefined;
}

/** The hands of a witness as the TEI export takes them. */
export function exportHands(hands: readonly WitnessHand[]): ExportHand[] {
  return hands.map((h) => ({
    id: h.id,
    label: h.label,
    ...(h.description ? { description: h.description } : {}),
    main: h.main,
  }));
}
