/**
 * The citation of a published version, the same in the reader's colophon
 * and on a withdrawn version's page: the editors, the title, the version and
 * the date of its publication, its lasting address, and the licence.
 */
import { and } from '$lib/strings/names';
import { reader as r } from '$lib/strings/reader';

export interface CitedVersion {
  editors: string[];
  title: string;
  number: number;
  /** When it was published, as an ISO date or timestamp. */
  at: string;
  /** Its lasting address, in full. */
  address: string;
  licence: string | null;
}

export function versionCitation(cited: CitedVersion): string {
  return r.colophon.citation(
    and(cited.editors),
    cited.title,
    r.version(cited.number),
    cited.at.slice(0, 10),
    cited.address,
    cited.licence,
  );
}
