/**
 * The family sigla of an edition: groups of witnesses of the conspectus,
 * each under a siglum of its own, which the apparatus prints for the
 * members wherever all of them have a reading.
 *
 * An edition stores a group by the sigla of its members, which is what the
 * apparatus matches. The conspectus dialog and its form action work with
 * the witnesses instead, so that a witness whose siglum is changed stays in
 * its group. Pure: the server and the dialog share it.
 */
import type { EditionConventions } from '@varians/db';

/** A group as the conventions store it. */
export type StoredGroup = NonNullable<EditionConventions['groups']>[number];

/** A group by the witnesses it stands for, as the dialog edits it and the form carries it. */
export interface GroupDraft {
  siglum: string;
  note?: string;
  witnessIds: string[];
}

/** An entry of the conspectus, as far as groups are concerned. */
export interface ConspectusEntry {
  witnessId: string;
  siglum: string;
  states?: { siglum: string }[];
  variantSiglum?: string | null;
}

/** What is wrong with a group, for a message that names it. */
export type GroupProblem =
  | { kind: 'siglum' }
  | { kind: 'too-few'; siglum: string }
  | { kind: 'taken'; siglum: string };

/**
 * The stored groups as drafts: each member siglum becomes the witness that
 * has it in the conspectus. A siglum the conspectus does not have names no
 * witness and is dropped.
 */
export function draftsOf(
  groups: readonly StoredGroup[] | undefined,
  conspectus: readonly Pick<ConspectusEntry, 'witnessId' | 'siglum'>[],
): GroupDraft[] {
  const witnessOf = new Map(conspectus.map((entry) => [entry.siglum, entry.witnessId] as const));
  return (groups ?? []).map((group) => ({
    siglum: group.siglum,
    ...(group.note ? { note: group.note } : {}),
    witnessIds: [
      ...new Set(group.members.map((m) => witnessOf.get(m)).filter((id) => id !== undefined)),
    ],
  }));
}

/**
 * Drafts against the conspectus as it is to be: the groups to store, or what
 * is wrong with one. A member that is not in the conspectus any more leaves
 * its group, and a group left with fewer than two members is removed; the
 * members are named by their sigla as the conspectus now has them, in its
 * order. A group's siglum must not be empty, nor that of a witness, a state,
 * a variant siglum or another group.
 *
 * `strict` is for groups an editor has just made: a group with fewer than two
 * witnesses, as it stands in the draft, is refused instead of being dropped.
 */
export function settleGroups(
  drafts: readonly GroupDraft[],
  conspectus: readonly ConspectusEntry[],
  { strict = false }: { strict?: boolean } = {},
): { groups: StoredGroup[] } | { problem: GroupProblem } {
  const groups: StoredGroup[] = [];
  for (const draft of drafts) {
    const siglum = draft.siglum.trim();
    const wanted = new Set(draft.witnessIds);
    if (strict && siglum === '') return { problem: { kind: 'siglum' } };
    if (strict && wanted.size < 2) return { problem: { kind: 'too-few', siglum } };
    const members = conspectus.filter((entry) => wanted.has(entry.witnessId));
    if (members.length < 2) continue;
    if (siglum === '') return { problem: { kind: 'siglum' } };
    const note = draft.note?.trim();
    groups.push({
      siglum,
      members: members.map((entry) => entry.siglum),
      ...(note ? { note } : {}),
    });
  }
  const taken = new Set(
    conspectus.flatMap((entry) =>
      [entry.siglum, ...(entry.states ?? []).map((s) => s.siglum), entry.variantSiglum].filter(
        (siglum): siglum is string => !!siglum,
      ),
    ),
  );
  for (const group of groups) {
    if (taken.has(group.siglum)) return { problem: { kind: 'taken', siglum: group.siglum } };
    taken.add(group.siglum);
  }
  return { groups };
}
