/**
 * Deterministic regularizations of Greek text, mirroring
 * App\Support\Transcription\GreekText — keep the two in step.
 *
 * Only ever removes what a scribe or editor added; never supplies what is
 * absent. Adding correct accents and breathings needs morphological analysis
 * and stays ambiguous even then, and a tool that got it silently wrong would
 * be worse than none, since its errors would read as scribal variants.
 *
 * The Leiden markup delimiters `[ ] { } _` are never touched.
 */

/** Oxia, varia, perispomeni. */
const ACCENTS = /[́̀͂]/gu;

/** Psili and dasia. */
const BREATHINGS = /[̓̔]/gu;

/** Every non-spacing combining mark. */
const DIACRITICS = /\p{Mn}+/gu;

/**
 * Listed rather than taken from a Unicode class, so that the markup
 * delimiters cannot be caught by widening the definition later.
 */
const PUNCTUATION = /[,.;:!?·’‘“”"'()«»—–\-‹›…]/gu;

function compose(text: string): string {
    return text.normalize('NFC');
}

function without(text: string, marks: RegExp): string {
    return compose(text.normalize('NFD').replace(marks, ''));
}

export function stripAccents(text: string): string {
    return without(text, ACCENTS);
}

export function stripBreathings(text: string): string {
    return without(text, BREATHINGS);
}

export function stripDiacritics(text: string): string {
    return without(text, DIACRITICS);
}

export function stripPunctuation(text: string): string {
    return compose(text.replace(PUNCTUATION, ''));
}

export type StripKind = 'accents' | 'breathings' | 'diacritics' | 'punctuation';

export function strip(text: string, kind: StripKind): string {
    switch (kind) {
        case 'accents':
            return stripAccents(text);
        case 'breathings':
            return stripBreathings(text);
        case 'diacritics':
            return stripDiacritics(text);
        case 'punctuation':
            return stripPunctuation(text);
    }
}

export type TextEdit = { start: number; end: number; text: string };

/**
 * The edit operations that turn `text` into its stripped form, as the
 * smallest set of character-range replacements.
 *
 * Emitted rather than replacing the text wholesale because every citation
 * span, image region and collated reading is recorded as offsets into this
 * text: a single op covering the whole document would read as "everything was
 * replaced" and flag or destroy all of them. Removing a mark from inside a
 * word instead falls strictly within any span covering it, which merely
 * shifts that span's end.
 *
 * Ops are returned in descending order so that each one's offsets are still
 * valid when it is applied — earlier positions are untouched by later edits.
 */
export function stripOps(text: string, kind: StripKind): TextEdit[] {
    const chars = [...text];
    const ops: TextEdit[] = [];
    let open: TextEdit | null = null;

    const close = () => {
        if (open) {
            ops.push(open);
            open = null;
        }
    };

    chars.forEach((char, index) => {
        const stripped = strip(char, kind);

        if (stripped === char) {
            close();

            return;
        }

        // Contiguous changes merge, so a fully unaccented word costs one
        // operation rather than one per letter.
        open = open
            ? { start: open.start, end: index + 1, text: open.text + stripped }
            : { start: index, end: index + 1, text: stripped };
    });

    close();

    return ops.reverse();
}
