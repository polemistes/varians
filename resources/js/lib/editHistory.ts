/**
 * Session-local undo/redo for the transcription editor's op log.
 *
 * Every edit is an exact {start, end, text} op, so every edit has an exact
 * inverse: replacing [start, end) with T inverts to replacing
 * [start, start + len(T)) with what stood there before — computable at
 * record time, when the pre-edit text is at hand. An undo therefore isn't a
 * special state rollback but an ordinary edit op routed through the same
 * pipeline (preview, span transform, autosave) as a keystroke.
 *
 * Grouping: consecutive plain typing coalesces into one step by time burst;
 * anything atomic (a paste, a cut, a strip-marks batch) is its own step, so
 * Ctrl-Z undoes it whole instead of one character at a time.
 *
 * An inverse inherits its op's `atomic` flag, so the sibling layer sees an
 * undo exactly as it saw the edit: the undo of an unmirrored keystroke run
 * stays in its layer, the undo of a mirrored paste removes the paste from
 * both. Stamping every undo atomic (the old rule) mirrored the inverse of
 * edits that had never mirrored — a two-letter deletion at a word's head,
 * undone, glued those letters onto the sibling's word (real bug). The
 * inverse of a mirrored removal also carries `mirror_text`, the sibling's
 * own former words, so the sibling gets its spelling back rather than ours.
 *
 * Cut/paste pairs stay pairs when travelling through history: the inverse of
 * a relocation is a relocation back (delete the pasted text, re-insert it at
 * the cut point), so the inverses keep a shared cut_id and the citations
 * ride home. Every pass through undo/redo re-mints the ids — the server
 * validates a pair within one request, and a repeated id in one save would
 * be refused as already claimed.
 */

import type { TextEditOp } from '@/lib/transcriptionEdit';

/**
 * The spans a destructive edit deleted — citation segments and
 * image-mapping regions alike — snapshotted at record time in the
 * coordinates of the text the edit was applied to, which is exactly the
 * state an undo of that edit restores, so the offsets land verbatim.
 * Deleting text deletes what was anchored to it; undoing the deletion
 * posts these rows back and restores everything.
 */
export type RestorableSegment = {
    canonical_passage_id: number;
    start_offset: number;
    end_offset: number;
    part: number;
};

export type RestorableRegion = {
    manuscript_image_id: number;
    start_offset: number;
    end_offset: number;
    position: number;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type RestorableSpans = {
    segments: RestorableSegment[];
    regions: RestorableRegion[];
};

/**
 * Where every LIVE span stood before a step — by row id, in the
 * coordinates of the text before the step's first op. An undo returns the
 * text to exactly that state, but not every span follows on its own: a
 * span whose head was deleted has right-gravity at its start, so the undo's
 * re-insertion pushes it past the restored words instead of covering them
 * again. Rows that differ from this after the undo are posted back as
 * adjustments (see TranscriptionSpanRestoreController).
 */
export type SpanSnapshot = {
    id: number;
    start_offset: number;
    end_offset: number;
    needs_review: boolean;
};

export type SpanSnapshots = {
    segments: SpanSnapshot[];
    regions: SpanSnapshot[];
};

export function emptyRestorableSpans(): RestorableSpans {
    return { segments: [], regions: [] };
}

export function emptySpanSnapshots(): SpanSnapshots {
    return { segments: [], regions: [] };
}

type HistoryEntry = {
    undoOps: TextEditOp[];
    redoOps: TextEditOp[];
    restore: RestorableSpans;
    snapshot: SpanSnapshots;
};

export type HistoryStep = {
    ops: TextEditOp[];
    restore: RestorableSpans;
    snapshot: SpanSnapshots;
};

const TYPING_BURST_MS = 750;

let mintCounter = 0;

function mintCutId(): string {
    return `h${Date.now().toString(36)}-${(mintCounter++).toString(36)}`;
}

/**
 * How the inverse of an op should meet the sibling layer: `atomic` says
 * whether it may mirror at all (only where the op itself could — see
 * TranscriptPane's inverseMirroring), `mirrorText` is what the sibling
 * should get back where the inverse re-inserts words the op removed.
 */
export type InverseMirroring = {
    atomic: boolean;
    mirrorText: string | null;
};

/**
 * The exact inverse of one op, given the text the op was applied to. With
 * no mirroring decision the inverse simply inherits its op's atomic flag.
 */
export function invertOp(
    textBefore: string,
    op: TextEditOp,
    mirroring: InverseMirroring | null = null,
): TextEditOp {
    const removed = [...textBefore].slice(op.start, op.end).join('');

    return {
        start: op.start,
        end: op.start + [...op.text].length,
        text: removed,
        cut_id: op.cut_id ?? null,
        atomic: mirroring?.atomic ?? op.atomic ?? false,
        mirror_text: mirroring?.mirrorText ?? null,
    };
}

export class EditHistory {
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    private openGroup: HistoryEntry | null = null;
    private openGroupLastAt = 0;

    /**
     * A cut and its paste are separate history entries, so the two halves of
     * a pair traverse undo/redo in separate `reIdentified` calls — minting
     * them independently left the halves with different ids, and the server
     * then saw an unpaired cut and tombstoned the citation the undo was
     * restoring (real bug). Instead the DELETE half of a pair opens a fresh
     * id here, keyed by the original, and the matching INSERT half consumes
     * it — both traversal directions present the delete half first (undo
     * inverts the paste before the cut; redo replays the cut before the
     * paste), so the pairing survives being split across entries.
     */
    private openReMints = new Map<string, string>();

    /** Fresh cut_ids for the ops of one traversed entry, halves kept paired. */
    private reIdentified(ops: TextEditOp[]): TextEditOp[] {
        return ops.map((op) => {
            if (!op.cut_id) {
                return op;
            }

            const isDeleteHalf = op.text === '' && op.end > op.start;

            if (isDeleteHalf) {
                const fresh = mintCutId();
                this.openReMints.set(op.cut_id, fresh);

                return { ...op, cut_id: fresh };
            }

            const open = this.openReMints.get(op.cut_id);

            if (open !== undefined) {
                this.openReMints.delete(op.cut_id);

                return { ...op, cut_id: open };
            }

            // No delete half in this traversal: this is the undo of a LONE
            // cut, and its other half is the original cut op itself, still
            // sitting unsaved in the log under this very id (the unpaired-cut
            // hold keeps it there). Keep the id, so the pair completes and
            // the flush relocates the citations home instead of tombstoning
            // them (real bug: a fresh id here paired with nothing, and the
            // undo of an accidental cut collapsed every citation the cut had
            // covered). If the cut somehow saved already, a lone insert
            // claiming its id degrades to a plain edit server-side — exactly
            // what a fresh id would have done.
            return op;
        });
    }

    /**
     * Record one applied op. `textBefore` is the text the op was applied to.
     * 'typing' ops coalesce into the current burst; 'atomic' ops close the
     * burst and stand alone. `snapshot` is where every live span stood
     * before the op — kept for the step's FIRST op only, since that is the
     * state undoing the whole step returns to.
     */
    record(
        op: TextEditOp,
        textBefore: string,
        kind: 'typing' | 'atomic' = 'typing',
        destroyed: RestorableSpans = emptyRestorableSpans(),
        snapshot: SpanSnapshots = emptySpanSnapshots(),
        mirroring: InverseMirroring | null = null,
    ): void {
        this.redoStack = [];

        const inverse = invertOp(textBefore, op, mirroring);
        const now = Date.now();
        const coalesce =
            kind === 'typing' &&
            this.openGroup !== null &&
            now - this.openGroupLastAt <= TYPING_BURST_MS;

        if (!coalesce) {
            this.closeGroup();
            this.openGroup = {
                undoOps: [],
                redoOps: [],
                restore: emptyRestorableSpans(),
                snapshot,
            };
        }

        // Undo ops run newest-first, each inverted against the text state
        // its original saw — prepending keeps that order.
        this.openGroup!.undoOps.unshift(inverse);
        this.openGroup!.redoOps.push(op);
        this.openGroup!.restore.segments.push(...destroyed.segments);
        this.openGroup!.restore.regions.push(...destroyed.regions);
        this.openGroupLastAt = now;

        if (kind === 'atomic') {
            this.closeGroup();
        }
    }

    /**
     * Record several ops as one indivisible step (a strip-marks batch, a
     * relocation pair). `textBefore` is the text before the FIRST op; the
     * rest are inverted against the intermediate states, which the caller
     * provides by applying ops one at a time via `apply`.
     */
    recordGroup(
        ops: TextEditOp[],
        textBefore: string,
        apply: (text: string, op: TextEditOp) => string,
        snapshot: SpanSnapshots = emptySpanSnapshots(),
    ): void {
        this.redoStack = [];
        this.closeGroup();

        const entry: HistoryEntry = {
            undoOps: [],
            redoOps: [],
            restore: emptyRestorableSpans(),
            snapshot,
        };
        let text = textBefore;

        for (const op of ops) {
            entry.undoOps.unshift(invertOp(text, op));
            entry.redoOps.push(op);
            text = apply(text, op);
        }

        if (entry.redoOps.length > 0) {
            this.undoStack.push(entry);
        }
    }

    /**
     * The ops that revert the most recent step (plus the citation rows the
     * step destroyed and where every span stood before it, for the caller
     * to restore once the text save lands), or null if there is none.
     */
    undo(): HistoryStep | null {
        this.closeGroup();
        const entry = this.undoStack.pop();

        if (!entry) {
            return null;
        }

        this.redoStack.push(entry);

        return {
            ops: this.reIdentified(entry.undoOps),
            restore: entry.restore,
            snapshot: entry.snapshot,
        };
    }

    /** The ops that re-apply the most recently undone step, or null. */
    redo(): HistoryStep | null {
        this.closeGroup();
        const entry = this.redoStack.pop();

        if (!entry) {
            return null;
        }

        this.undoStack.push(entry);

        // Redo re-applies the destructive edit; the transform deletes the
        // restored rows again server-side, and `restore`/`snapshot` stay on
        // the entry for the next undo.
        return {
            ops: this.reIdentified(entry.redoOps),
            restore: emptyRestorableSpans(),
            snapshot: emptySpanSnapshots(),
        };
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0 || this.openGroup !== null;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.openGroup = null;
        this.openReMints.clear();
    }

    private closeGroup(): void {
        if (this.openGroup !== null && this.openGroup.redoOps.length > 0) {
            this.undoStack.push(this.openGroup);
        }

        this.openGroup = null;
    }
}
