/**
 * Citations of conjectures and reported readings as the registry forms
 * carry them: the picker's drafts from what a record cites, the hidden
 * field the drafts travel in, and the line the catalogue prints.
 */
import type { CitationDraft } from '$lib/bibliography/types';
import type { Cited } from './types';

/** What a record cites, as the picker edits it. */
export function draftsOf(cited: Cited[] | undefined): CitationDraft[] {
  return (cited ?? []).map((c) => ({
    itemId: c.itemId,
    label: c.label,
    prenote: c.prenote ?? '',
    postnote: c.postnote ?? '',
  }));
}

/** The hidden `citations` field: [{ itemId, prenote, postnote }] as JSON, empty notes as null. */
export function citationsPayload(drafts: CitationDraft[]): string {
  return JSON.stringify(
    drafts.map((d) => ({
      itemId: d.itemId,
      prenote: d.prenote.trim() || null,
      postnote: d.postnote.trim() || null,
    })),
  );
}

/** "cf. West 1998, 45; Allen 1931" */
export function citedText(cited: Cited[] | undefined): string {
  return (cited ?? []).map((c) => c.text).join('; ');
}
