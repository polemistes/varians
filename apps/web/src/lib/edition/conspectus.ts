/**
 * The conspectus as Make New Edition, Edition Settings and the editor's
 * Witnesses and Sigla window edit it: one row per witness, with the siglum
 * it goes by in the edition and the transcript collated, if any. Types and
 * pure helpers, shared by the server and the browser.
 */
import type { SiglumState, WitnessHand } from '@varians/db';

/** A transcript of a witness that a person may put in a conspectus. */
export interface TranscriptChoice {
  id: string;
  name: string;
  ownerName: string;
  /** Whether the person choosing owns it. */
  own: boolean;
  /** The segments of the edition's work it has text of; none before a work is chosen. */
  segments: number;
}

/** A witness as a row of the conspectus needs it. */
export interface ConspectusWitness {
  id: string;
  slug: string;
  name: string;
  siglum: string;
  hands: WitnessHand[];
  transcripts: TranscriptChoice[];
}

/** A row of the conspectus as it is saved. */
export interface ConspectusRow {
  witnessId: string;
  transcriptionId: string | null;
  siglum: string;
  states: SiglumState[];
  variantSiglum: string | null;
}

/** A witness offered first when one is added: it has a transcript of the work, or readings reported of it. */
export interface SuggestedWitness {
  id: string;
  slug: string;
  name: string;
  siglum: string;
  reason: 'transcribed' | 'reported';
}

/**
 * The transcript a witness brings when it is added: its only one, else the
 * only one with text of the work, else none.
 */
export function initialTranscript(witness: ConspectusWitness): string | null {
  if (witness.transcripts.length === 1) return witness.transcripts[0]!.id;
  const withText = witness.transcripts.filter((t) => t.segments > 0);
  return withText.length === 1 ? withText[0]!.id : null;
}

/** A row for a witness just added: its own siglum, its transcript as initialTranscript chooses. */
export function newRow(witness: ConspectusWitness): ConspectusRow {
  return {
    witnessId: witness.id,
    transcriptionId: initialTranscript(witness),
    siglum: witness.siglum,
    states: [],
    variantSiglum: null,
  };
}
