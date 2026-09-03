/**
 * What the last in-app transcript copy took, so a paste into ANOTHER layer
 * can bring the citation assignments and facsimile mappings along (see
 * TranscriptionSpanCopyController). Module scope on purpose: the copy and
 * the paste happen in different pane components, and possibly across a
 * navigation between them.
 */
export type TranscriptCopy = {
    layerId: number;
    start: number;
    end: number;
    text: string;
};

let stash: TranscriptCopy | null = null;

export function rememberTranscriptCopy(copy: TranscriptCopy): void {
    stash = copy;
}

/**
 * The remembered copy, if its text is exactly what was pasted — anything
 * else (edited text, an outside source) is an ordinary paste.
 */
export function matchTranscriptCopy(text: string): TranscriptCopy | null {
    return stash !== null && stash.text === text ? stash : null;
}
