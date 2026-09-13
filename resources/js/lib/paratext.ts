/**
 * How a paratext is laid out — the pure half of the edition page's
 * paratext rendering (see EditionParatext and Editions/Show.vue).
 *
 * A paratext stands before or after a word. Its KIND says where the
 * editor wants it (a margin, inline, or a speaker indication), and for
 * speaker indications the edition's speaker layout says how those are set
 * — which may depend on whether the indication opens a printed line.
 */
import type { ParatextKind } from '@/types/edition';
import type { SpeakerDisplay } from '@/types/models';

/** Where one paratext actually renders. */
export type ParatextLayout =
    | 'inline'
    | 'left_margin'
    | 'right_margin'
    | 'own_line'
    | 'own_line_centered';

/**
 * Whether a point BEFORE a run is the beginning of a printed line: the
 * run opens its piece and that piece opens the edition or starts a new
 * line, or the run carries a break of its own. Wrapping is not a line
 * beginning — lines here are the edition's lineation.
 */
export function isLineStart(at: {
    placement: 'before' | 'after';
    firstRunOfPiece: boolean;
    firstPiece: boolean;
    segmentStartsLine: boolean;
    breakBefore: 'line' | 'paragraph' | null;
}): boolean {
    if (at.placement === 'after') {
        return false;
    }

    if (at.firstRunOfPiece) {
        return at.firstPiece || at.segmentStartsLine;
    }

    return at.breakBefore !== null;
}

/** The layout a paratext of this kind takes under the edition's speaker setting. */
export function layoutOf(
    kind: ParatextKind,
    speakerDisplay: SpeakerDisplay,
    atLineStart: boolean,
): ParatextLayout {
    if (kind !== 'speaker') {
        return kind;
    }

    switch (speakerDisplay) {
        case 'inline':
            return 'inline';
        case 'line_start_margin':
            return atLineStart ? 'left_margin' : 'inline';
        case 'own_line':
            return 'own_line';
        case 'own_line_centered':
            return 'own_line_centered';
    }
}

/**
 * Tops for boxes stacked down one margin: each box is asked for at the
 * top of its own line, and one that would overlap the box above it is
 * moved down under it instead. Boxes are given in any order.
 */
export function stackMarginBoxes(
    boxes: { key: string; top: number; height: number }[],
    gap = 4,
): Map<string, number> {
    const placed = new Map<string, number>();
    let floor = Number.NEGATIVE_INFINITY;

    for (const box of [...boxes].sort((a, b) => a.top - b.top)) {
        const top = Math.max(box.top, floor);
        placed.set(box.key, top);
        floor = top + box.height + gap;
    }

    return placed;
}
