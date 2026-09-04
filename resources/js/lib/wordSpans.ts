/**
 * Projections between character offsets and word coordinates — the client
 * mirror of App\Support\Transcription\WordSpans; keep the two in step (the
 * PHP side's WordSpansTest is the contract). The two layers of a transcript
 * share a word skeleton: word 12 is word 12 in either spelling, however
 * many characters each form takes, so a span stored as a word range of the
 * transcript projects onto each layer's own character offsets exactly.
 */

export type WordSpan = { start: number; end: number };
export type WordAnchor = { word: number; char: number };

/** The words of a text, as character spans. */
export function words(text: string): WordSpan[] {
    const result: WordSpan[] = [];

    for (const match of text.matchAll(/\S+/gu)) {
        result.push({
            start: match.index,
            end: match.index + match[0].length,
        });
    }

    return result;
}

/** The word range covering [start, end), snapped outward to whole words. */
export function toWordRange(
    text: string,
    start: number,
    end: number,
): [number, number] {
    const all = words(text);

    let from = all.length;

    for (const [index, word] of all.entries()) {
        if (word.end > start) {
            from = index;
            break;
        }
    }

    let to = 0;

    for (const [index, word] of all.entries()) {
        if (word.start < end) {
            to = index + 1;
        }
    }

    return to > from ? [from, to] : [from, from];
}

/** The character range a word range covers in this layer's spelling. */
export function toCharRange(
    text: string,
    startWord: number,
    endWord: number,
): [number, number] {
    const all = words(text);

    if (all.length === 0) {
        return [0, 0];
    }

    if (endWord <= startWord) {
        const at =
            startWord >= all.length
                ? all[all.length - 1].end
                : all[Math.max(0, startWord)].start;

        return [at, at];
    }

    const start = all[Math.min(Math.max(0, startWord), all.length - 1)].start;
    const end = all[Math.min(endWord, all.length) - 1].end;

    return [start, end];
}

/** A sub-word START anchor: in whitespace it snaps forward. */
export function startAnchor(text: string, offset: number): WordAnchor {
    const all = words(text);

    for (const [index, word] of all.entries()) {
        if (word.end > offset) {
            return { word: index, char: Math.max(0, offset - word.start) };
        }
    }

    const last = all.length - 1;

    return last < 0
        ? { word: 0, char: 0 }
        : { word: last, char: all[last].end - all[last].start };
}

/** A sub-word END anchor: in whitespace it snaps back. */
export function endAnchor(text: string, offset: number): WordAnchor {
    const all = words(text);

    for (let index = all.length - 1; index >= 0; index--) {
        const word = all[index];

        if (word.start < offset) {
            return {
                word: index,
                char: Math.min(offset, word.end) - word.start,
            };
        }
    }

    return { word: 0, char: 0 };
}

/**
 * The character offset an anchor names in this layer's spelling, clamped
 * to the word's own length (spellings differ in length across layers).
 */
export function fromAnchor(text: string, word: number, char: number): number {
    const all = words(text);

    if (all.length === 0) {
        return 0;
    }

    const target = all[Math.min(Math.max(0, word), all.length - 1)];

    return target.start + Math.min(char, target.end - target.start);
}
