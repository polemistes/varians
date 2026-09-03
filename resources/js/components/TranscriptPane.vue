<script setup lang="ts">
import { router, useForm, usePage } from '@inertiajs/vue3';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import AlignableText from '@/components/AlignableText.vue';
import { isEditorOrAbove } from '@/lib/auth';
import {
    confirmDeletion,
    describeDeletionImpact,
    pluralize,
} from '@/lib/deletionImpact';
import { EditHistory } from '@/lib/editHistory';
import { stripOps } from '@/lib/greekText';
import type { StripKind } from '@/lib/greekText';
import { applyOps, transformSpans } from '@/lib/transcriptionEdit';
import type { EditSource, TextEditOp } from '@/lib/transcriptionEdit';
import { store as storePageBreak } from '@/routes/transcription-page-breaks';
import {
    store as storeRegion,
    storeBatch as storeRegionBatch,
} from '@/routes/transcription-regions';
import {
    assign as assignCitationRoute,
    destroy as destroySegment,
    store as storeSegment,
    update as updateSegment,
} from '@/routes/transcription-segments';
import {
    destroy as destroyTranscription,
    update as updateTranscription,
} from '@/routes/transcriptions';
import { create as createLayerCopy } from '@/routes/transcriptions/copy';
import { update as updateTranscriptionText } from '@/routes/transcriptions/text';
import type { Auth } from '@/types/auth';
import type {
    Transcription,
    TranscriptionLayer,
    TranscriptionPageBreak,
    TranscriptionRegion,
    TranscriptionSegment,
    Work,
} from '@/types/models';

/** One pane's server payload — see WitnessController::panePayload. */
export type PanePayload = {
    view: 'layer' | 'facsimile';
    layer: TranscriptionLayer | null;
    pageBreaks: TranscriptionPageBreak[];
    correspondence: {
        sibling: string;
        text: string;
        divergence: {
            line: number;
            a_words: number | null;
            b_words: number | null;
        } | null;
    } | null;
};

const props = defineProps<{
    pane: PanePayload;
    transcripts: Transcription[];
    works: Work[];
    selectedPageId: number | null;
    /** The layer open in the other pane, disabled in this pane's picker. */
    otherLayerId: number | null;
    /** Ids for the region-hover coupling with a facsimile pane. */
    hoveredRegionId: number | null;
}>();

const emit = defineEmits<{
    /** Open a different layer in this pane — the page navigates. */
    (e: 'navigate', layerId: number): void;
    /** A selection now exists (or not) — enables the Pages box placement. */
    (e: 'selection-changed', has: boolean): void;
    /** Drawing armed: the page brings the facsimile up in the other pane. */
    (e: 'arm-drawing'): void;
    (e: 'cancel-drawing'): void;
    (e: 'hover-region', id: number | null): void;
}>();

const layer = computed(() => props.pane.layer);
const layerText = computed(() => layer.value?.text ?? '');
const layerSegments = computed(() => layer.value?.segments ?? []);
const layerRegions = computed(() => layer.value?.regions ?? []);

const page = usePage<{ auth: Auth; flash?: { message?: string | null } }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

// ---- edit text: an ordered log of exact edit operations, applied locally
// (via transcriptionEdit.ts, mirroring App\Support\Transcription\
// SpanTransformer/TextOpApplier) for instant visual feedback, and autosaved
// on a short idle debounce — see TranscriptionTextController for the
// authoritative server-side replay.
const editOps = ref<TextEditOp[]>([]);

const editedText = computed(() => applyOps(layerText.value, editOps.value));

function transformedSpans<
    T extends {
        start_offset: number;
        end_offset: number;
        needs_review: boolean;
    },
>(
    spans: T[],
): (T & { start_offset: number; end_offset: number; needs_review: boolean })[] {
    const transformed = transformSpans(
        spans.map((span) => ({
            start: span.start_offset,
            end: span.end_offset,
            needsReview: span.needs_review,
        })),
        editOps.value,
    );

    // Destroyed segments stay in the preview as zero-width, flagged
    // tombstones — exactly what the server keeps, so what the editor sees is
    // what saves. Destroyed regions drop, mirroring the server's deletion.
    return spans.flatMap((span, index) => {
        const result = transformed[index];

        if (result.deleted && !('canonical_passage_id' in span)) {
            return [];
        }

        return [
            {
                ...span,
                start_offset: result.start,
                end_offset: result.end,
                needs_review: result.needsReview,
            },
        ];
    });
}

const editedSegments = computed<TranscriptionSegment[]>(() =>
    transformedSpans(layerSegments.value),
);

const editedRegions = computed<TranscriptionRegion[]>(() =>
    transformedSpans(layerRegions.value).map((region) => ({
        ...region,
        text: editedText.value.slice(region.start_offset, region.end_offset),
    })),
);

// A tombstone is not a live citation, so "this would wipe everything" means
// no segment would keep any text at all.
const wouldDeleteAllSegments = computed(
    () =>
        layerSegments.value.some(
            (segment) => segment.end_offset > segment.start_offset,
        ) &&
        editedSegments.value.every(
            (segment) => segment.end_offset === segment.start_offset,
        ),
);
const wouldDeleteAllRegions = computed(
    () => layerRegions.value.length > 0 && editedRegions.value.length === 0,
);
const needsDeleteConfirmation = computed(
    () => wouldDeleteAllSegments.value || wouldDeleteAllRegions.value,
);
const deleteConfirmed = ref(false);

const savingText = ref(false);
const textSaveError = ref<string | null>(null);
// The one save failure that cannot be retried: another editor changed the
// text under us, so the whole op log is against a stale base. Autosave stops
// and the editor is asked to reload.
const staleTextError = ref<string | null>(null);

// Set by the server when a saved edit also changed an edition's own printed
// wording — the one consequence an editor cannot see from this page. Not an
// error and nothing to confirm; see TranscriptionTextController::applyReadings.
const textSaveNotice = computed(() => page.props.flash?.message ?? null);

// ---- undo/redo: a stack of inverse ops (see lib/editHistory.ts). An undo
// is itself an ordinary edit op, so it previews and autosaves like typing.
const history = new EditHistory();
const historyVersion = ref(0); // canUndo/canRedo are not reactive on their own

// ---- cut/paste pairing: a cut op remembers exactly what it removed; the
// first paste of that exact text gets the same cut_id, making the pair a
// citation-preserving relocation (see SpanTransformer). Everything else is
// an ordinary edit.
let cutCounter = 0;
const outstandingCuts = new Map<string, string>(); // cut_id -> cut text

function codePointSlice(text: string, start: number, end: number): string {
    return [...text].slice(start, end).join('');
}

type PaneEditSource = EditSource | 'atomic';

function applyEdit(op: TextEditOp, source: PaneEditSource) {
    const textBefore = editedText.value;

    if (source === 'cut') {
        const cutId = `c${Date.now().toString(36)}-${(cutCounter++).toString(36)}`;
        op = { ...op, cut_id: cutId };
        outstandingCuts.set(
            cutId,
            codePointSlice(textBefore, op.start, op.end),
        );
    } else if (source === 'paste') {
        const match = [...outstandingCuts.entries()].find(
            ([, text]) => text === op.text,
        );

        if (match) {
            op = { ...op, cut_id: match[0] };
            outstandingCuts.delete(match[0]);
        }
    }

    editOps.value = [...editOps.value, op];
    history.record(op, textBefore, source === 'typing' ? 'typing' : 'atomic');
    historyVersion.value++;
    transformRememberedSelection([op]);
    deleteConfirmed.value = false;
    textSaveError.value = null;
    scheduleAutosave();
}

function onEdit(op: TextEditOp, source: PaneEditSource = 'typing') {
    // Typed inside the page, recorded against the whole text — that is what
    // the server replays and what every other offset is measured in.
    applyEdit(
        { start: toFull(op.start), end: toFull(op.end), text: op.text },
        source,
    );
}

/**
 * Strip a class of marks from the SELECTED text — one undo step, however
 * many ops it takes. Goes through the same pending-ops mechanism as typing,
 * rather than replacing the text outright: every citation span, image region
 * and collated reading is recorded as offsets into this text, and a
 * wholesale replacement would read as "all of it changed".
 */
function stripFromSelection(kind: StripKind) {
    if (!activeSelection.value) {
        return;
    }

    const { start, end } = activeSelection.value;
    const ops = stripOps(editedText.value.slice(start, end), kind).map(
        (op) => ({ ...op, start: op.start + start, end: op.end + start }),
    );

    if (ops.length === 0) {
        return;
    }

    history.recordGroup(ops, editedText.value, (text, op) =>
        applyOps(text, [op]),
    );
    historyVersion.value++;
    editOps.value = [...editOps.value, ...ops];
    transformRememberedSelection(ops);
    deleteConfirmed.value = false;
    textSaveError.value = null;
    scheduleAutosave();
}

function performUndo() {
    applyHistoryOps(history.undo());
}

function performRedo() {
    applyHistoryOps(history.redo());
}

const canUndo = computed(() => historyVersion.value >= 0 && history.canUndo);
const canRedo = computed(() => historyVersion.value >= 0 && history.canRedo);

function applyHistoryOps(ops: TextEditOp[] | null) {
    if (!ops || ops.length === 0) {
        return;
    }

    editOps.value = [...editOps.value, ...ops];
    historyVersion.value++;
    transformRememberedSelection(ops);
    deleteConfirmed.value = false;
    textSaveError.value = null;
    scheduleAutosave();

    const last = ops[ops.length - 1];
    void nextTick(() =>
        textEl.value?.restoreCaretAt(
            toPage(last.start + [...last.text].length),
        ),
    );
}

// ---- autosave: debounced, single-flight. Only the ops up to the first
// still-unpaired cut are sent — a cut and its paste must reach the server in
// the same request to relocate rather than tombstone — and a forced flush
// (before any action that posts offsets, or on leaving) sends everything,
// degrading an unpaired cut to a safe tombstone.
const AUTOSAVE_IDLE_MS = 800;
const CUT_HOLD_MS = 20000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let cutHeldSince: number | null = null;

const unsavedOps = computed(() => editOps.value.length > 0);

function scheduleAutosave() {
    if (autosaveTimer !== null) {
        clearTimeout(autosaveTimer);
    }

    autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        void flushText(false);
    }, AUTOSAVE_IDLE_MS);
}

function flushableOpCount(force: boolean): number {
    if (force) {
        return editOps.value.length;
    }

    // Hold back from the first cut-half whose paste-half hasn't joined the
    // log yet — a pair must reach the server in one request to relocate
    // rather than tombstone. This covers both a clipboard cut awaiting its
    // paste AND the halves of an undo/redo in progress (undoing a
    // relocation replays its pair across two history steps).
    const held = editOps.value.findIndex(
        (op, index) =>
            op.cut_id != null &&
            op.text === '' &&
            op.end > op.start &&
            !editOps.value.some(
                (later, laterIndex) =>
                    laterIndex > index &&
                    later.cut_id === op.cut_id &&
                    later.text !== '' &&
                    later.start === later.end,
            ),
    );

    if (held === -1) {
        return editOps.value.length;
    }

    // An outstanding cut older than the hold window stops waiting for its
    // paste — tombstoning is the safe degradation, losing nothing.
    if (cutHeldSince !== null && Date.now() - cutHeldSince > CUT_HOLD_MS) {
        return editOps.value.length;
    }

    if (cutHeldSince === null) {
        cutHeldSince = Date.now();
    }

    return held;
}

/**
 * Save the current op log (or its sendable prefix). Resolves true when
 * nothing remains blocked or errored — the precondition for any action that
 * posts text offsets to the server.
 */
function flushText(force: boolean): Promise<boolean> {
    if (!layer.value || staleTextError.value !== null) {
        return Promise.resolve(false);
    }

    if (savingText.value) {
        // Single-flight: try again once the in-flight save lands.
        return new Promise((resolve) => {
            setTimeout(() => void flushText(force).then(resolve), 150);
        });
    }

    if (needsDeleteConfirmation.value && !deleteConfirmed.value && !force) {
        // Don't autosave a state that wipes every citation/alignment until
        // the editor has confirmed it (or undone it).
        return Promise.resolve(true);
    }

    const count = flushableOpCount(force);

    if (count === 0) {
        if (editOps.value.length > 0) {
            scheduleAutosave();
        }

        return Promise.resolve(editOps.value.length === 0);
    }

    const sending = editOps.value.slice(0, count);
    savingText.value = true;

    return new Promise((resolve) => {
        router.patch(
            updateTranscriptionText.url(layer.value!),
            {
                ops: sending,
                text: applyOps(layerText.value, sending),
            },
            {
                preserveScroll: true,
                // Both panes: a mirrored relocation changes the sibling
                // layer, which may be the one open opposite.
                only: ['leftPane', 'rightPane', 'flash'],
                onSuccess: () => {
                    editOps.value = editOps.value.slice(sending.length);
                    cutHeldSince = null;

                    for (const op of sending) {
                        if (op.cut_id != null) {
                            outstandingCuts.delete(op.cut_id);
                        }
                    }

                    savingText.value = false;

                    if (editOps.value.length > 0) {
                        // More ops arrived mid-flight (or were held back): a
                        // forced flush keeps going until the log is empty; an
                        // autosave just reschedules.
                        if (force) {
                            void flushText(true).then(resolve);
                        } else {
                            scheduleAutosave();
                            resolve(true);
                        }

                        return;
                    }

                    resolve(true);
                },
                onError: (errors) => {
                    savingText.value = false;

                    if (errors.ops) {
                        staleTextError.value = errors.ops;
                        resolve(false);

                        return;
                    }

                    // Most likely transiently invalid markup (an unclosed
                    // bracket mid-typing) — keep the ops and retry after the
                    // next edit rather than nagging.
                    textSaveError.value =
                        Object.values(errors)[0] ??
                        'Could not save these changes.';
                    resolve(false);
                },
            },
        );
    });
}

/**
 * After a stale-text conflict the whole op log is against a base another
 * editor has since changed — discard it and fetch the current state.
 */
function reloadAfterConflict() {
    editOps.value = [];
    history.clear();
    historyVersion.value++;
    outstandingCuts.clear();
    cutHeldSince = null;
    staleTextError.value = null;
    textSaveError.value = null;
    router.reload();
}

function onBeforeUnload(event: BeforeUnloadEvent) {
    if (unsavedOps.value) {
        event.preventDefault();
    }
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload));

// A different layer is a different text — the op log, history and cut stash
// all belong to the one that was open.
watch(
    () => layer.value?.id,
    () => {
        editOps.value = [];
        history.clear();
        historyVersion.value++;
        outstandingCuts.clear();
        cutHeldSince = null;
        deleteConfirmed.value = false;
        textSaveError.value = null;
        staleTextError.value = null;
        clearSelection();
    },
);

// The text/segments/regions actually rendered: always the live-edited local
// state, so highlighted spans (and tombstones) visibly move as the scholar
// types. With an empty op log these equal exactly what's persisted.
const activeText = computed(() => editedText.value);
const activeSegments = computed(() => editedSegments.value);
const activeRegions = computed(() => editedRegions.value);

// ---- pages ----
// The pane shows only the text standing on the page being worked on.
// A page runs from its own break to the next one — see TranscriptionPageBreak
// — and text before the first break belongs to no page yet. Everything else
// works in whole-text offsets, so the slice is converted at exactly two
// places inbound (a selection, an edit) and at the props handed to
// AlignableText outbound. `toFull` and `toPage` are the only conversions.

/** The character offset at which a line begins in the given text. */
function offsetOfLine(text: string, line: number): number {
    if (line <= 0) {
        return 0;
    }

    const lines = text.split('\n');
    let offset = 0;

    for (let index = 0; index < line; index++) {
        if (lines[index] === undefined) {
            return text.length;
        }

        offset += lines[index].length + 1;
    }

    return Math.min(offset, text.length);
}

// The division is held in lines on the transcript, because that is the one
// coordinate both layers share: their character offsets differ, but a line
// of the transcript is a line of the manuscript in either. Each layer
// resolves it against its own text here.
const breaks = computed(() =>
    [...props.pane.pageBreaks]
        .sort((a, b) => a.start_line - b.start_line)
        .map((item) => ({
            ...item,
            start_offset: offsetOfLine(activeText.value, item.start_line),
        })),
);

/** The break for the selected page, if that page has been placed here. */
const selectedBreak = computed(
    () =>
        breaks.value.find(
            (item) => item.manuscript_page_id === props.selectedPageId,
        ) ?? null,
);

const pageStart = computed(() => selectedBreak.value?.start_offset ?? 0);

const pageEnd = computed(() => {
    // The stretch before the first page begins, which belongs to no page yet.
    if (props.selectedPageId === null) {
        return breaks.value[0]?.start_offset ?? activeText.value.length;
    }

    // A page not yet placed shows the whole text, because placing it *is*
    // choosing where in the text it begins — there is nothing to narrow to
    // yet. Running to the first break instead left the pane empty as soon as
    // one page had been placed, so the second could never be.
    if (selectedBreak.value === null) {
        return activeText.value.length;
    }

    const next = breaks.value.find(
        (item) => item.start_offset > selectedBreak.value!.start_offset,
    );

    return next?.start_offset ?? activeText.value.length;
});

function toFull(offset: number): number {
    return offset + pageStart.value;
}

function toPage(offset: number): number {
    return offset - pageStart.value;
}

/** The text, segments and regions of the page alone, in page coordinates. */
const pageText = computed(() =>
    activeText.value.slice(pageStart.value, pageEnd.value),
);

function withinPage<T extends { start_offset: number; end_offset: number }>(
    spans: T[],
): T[] {
    return spans
        .filter(
            (span) =>
                span.start_offset >= pageStart.value &&
                span.end_offset <= pageEnd.value,
        )
        .map((span) => ({
            ...span,
            start_offset: toPage(span.start_offset),
            end_offset: toPage(span.end_offset),
        }));
}

const pageSegments = computed(() => withinPage(activeSegments.value));
const pageRegions = computed(() => withinPage(activeRegions.value));

// ---- pane header: which layer, of which transcript ----
const currentValue = computed(() => `layer-${layer.value?.id ?? ''}`);

function onPickLayer(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    const match = value.match(/^layer-(\d+)$/);

    if (!match || Number(match[1]) === layer.value?.id) {
        return;
    }

    // Autosave leaves nothing to discard — flush whatever is pending, then
    // navigate. Only a stale-text conflict blocks, and that needs the reload
    // the visit performs anyway.
    void flushText(true).then(() => emit('navigate', Number(match[1])));
}

// A plain ref (not a separate useForm) so this always PATCHes the *current*
// visibility — a useForm's initial state is captured once at setup and would
// go stale if it captured the transcript's visibility instead.
const visibility = ref(layer.value?.transcription?.visibility ?? 'draft');

watch(
    () => layer.value?.transcription?.visibility,
    (value) => {
        visibility.value = value ?? 'draft';
    },
);

function saveVisibility() {
    router.patch(
        updateTranscription.url(layer.value!),
        { visibility: visibility.value },
        { preserveScroll: true },
    );
}

function removeTranscript() {
    const parts = describeDeletionImpact(layer.value?.deletion_impact, [
        { key: 'segments', label: (n) => pluralize(n, 'citation') },
        { key: 'regions', label: (n) => pluralize(n, 'image alignment') },
        {
            key: 'editionSelections',
            label: (n) =>
                pluralize(
                    n,
                    'lemma selection in a published edition',
                    'lemma selections in published editions',
                ),
        },
        {
            key: 'editionPassages',
            label: (n) =>
                pluralize(
                    n,
                    'line currently sourced from this witness in a published edition',
                    'lines currently sourced from this witness in published editions',
                ),
        },
    ]);

    if (!confirmDeletion('this transcript', parts)) {
        return;
    }

    if (layer.value) {
        router.delete(destroyTranscription.url(layer.value));
    }
}

// The copy page posts this layer's saved text, so what is on screen must be
// what the server has: flush-then-navigate.
function openCopyPage() {
    if (!layer.value) {
        return;
    }

    void flushText(true).then(() => {
        router.get(createLayerCopy.url(layer.value!.id));
    });
}

// Importing is an insertion, not a separate kind of operation: the file's
// text goes in at the caret and becomes a pending edit like anything typed.
const importing = ref(false);
const importError = ref<string | null>(null);
const textEl = ref<{
    caretOffset: () => number | null;
    restoreCaretAt: (offset: number) => void;
    selectRangeAt: (start: number, end: number) => void;
} | null>(null);

function importFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (!file || !layer.value) {
        return;
    }

    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
        importError.value = 'That is not a plain-text file.';

        return;
    }

    const reader = new FileReader();

    reader.onload = () => {
        const text = String(reader.result ?? '');

        if (text.trim() === '') {
            importError.value = 'The file has no text to import.';

            return;
        }

        // At the caret, and only there. Falling back to the end of the page
        // put the text on the *next* one: an insertion at a page boundary
        // belongs to the page that begins there, which is right but not what
        // anyone would expect from a file they had just chosen.
        const at = textEl.value?.caretOffset() ?? activeSelection.value?.start;

        if (at === null || at === undefined) {
            importError.value =
                pageText.value === ''
                    ? 'Click in the empty text area first, then choose the file again.'
                    : 'Click where the text should go first, then choose the file again.';

            return;
        }

        onEdit({ start: at, end: at, text }, 'atomic');

        importError.value = null;
        importing.value = false;
    };

    reader.onerror = () => {
        importError.value = 'That file could not be read.';
    };

    reader.readAsText(file);
}

// ---- selection: selecting is just selecting. The floating actions under
// the selection's last line act on it when PRESSED — no menu pops up from
// the act of selecting, and nothing is ever inserted into the text flow
// (the overlay is an absolutely positioned sibling of the surface).
type ActiveSelection = { start: number; end: number; text: string };
const activeSelection = ref<ActiveSelection | null>(null);
type SelectionMenu = 'align' | 'assign';
const activeMenu = ref<SelectionMenu | null>(null);

// What making a selection does, beyond selecting: nothing (quiet for
// ordinary text editing), or open one of the marking dialogues directly —
// the mark-line-after-line workflows where pressing a button every time is
// the friction. Persisted per browser.
type SelectAction = 'none' | 'align' | 'assign';
const ACTION_ON_SELECT_KEY = 'varians:action-on-select';

function storedActionOnSelect(): SelectAction {
    try {
        const raw = localStorage.getItem(ACTION_ON_SELECT_KEY);

        return raw === 'align' || raw === 'assign' ? raw : 'none';
    } catch {
        return 'none';
    }
}

const actionOnSelect = ref<SelectAction>(storedActionOnSelect());

// Whether the floating dialogue is up at all. A plain selection only raises
// it when an action is chosen above — during ordinary text editing,
// selections happen constantly and a box popping up under each one is
// noise. A badge click is an explicit press and always opens it.
const overlayVisible = ref(false);

watch(actionOnSelect, (value) => {
    try {
        localStorage.setItem(ACTION_ON_SELECT_KEY, value);
    } catch {
        // Storage unavailable — the in-session choice still works.
    }
});
const regionError = ref<string | null>(null);
const assignError = ref<string | null>(null);
const drawingArmed = ref(false);

watch(activeSelection, (selection) =>
    emit('selection-changed', selection !== null),
);

// Where the floating actions sit: just under the last line of the
// selection, measured from the live selection's rectangles relative to the
// text wrapper. Recomputed after edits so it follows the text.
const textWrapEl = ref<HTMLElement | null>(null);
const selectionAnchor = ref<{ top: number; left: number } | null>(null);

function updateSelectionAnchor() {
    const selection = window.getSelection();
    const wrap = textWrapEl.value;

    if (
        !wrap ||
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed
    ) {
        return;
    }

    const rects = selection.getRangeAt(0).getClientRects();

    if (rects.length === 0) {
        return;
    }

    const last = rects[rects.length - 1];
    const wrapRect = wrap.getBoundingClientRect();

    // The wrapper scrolls (long pages), so the absolute overlay lives in
    // content coordinates: add what has scrolled away.
    selectionAnchor.value = {
        top: last.bottom - wrapRect.top + wrap.scrollTop,
        left: Math.max(
            0,
            Math.min(
                last.left - wrapRect.left + wrap.scrollLeft,
                wrapRect.width - 320,
            ),
        ),
    };
}

const assignForm = useForm({ work_id: '' as number | '', label: '' });

// Remembered across selections so a scholar marking up a run of consecutive
// lines doesn't have to re-pick the work and retype the next line number
// each time. Persisted per layer in localStorage: citing a manuscript is
// multi-session work, and losing the running line number to a reload reads
// as the feature being broken.
function lastCitationKey(): string {
    return `varians:last-citation:${layer.value?.id ?? 'none'}`;
}

function storedLastCitation(): { workId: number | ''; label: string } {
    try {
        const raw = localStorage.getItem(lastCitationKey());

        if (raw !== null) {
            const parsed = JSON.parse(raw) as {
                workId?: number;
                label?: string;
            };

            return {
                workId: typeof parsed.workId === 'number' ? parsed.workId : '',
                label: typeof parsed.label === 'string' ? parsed.label : '',
            };
        }
    } catch {
        // Unreadable storage (private window, quota) — start fresh.
    }

    return { workId: '', label: '' };
}

const lastWorkId = ref<number | ''>(storedLastCitation().workId);
const lastLabel = ref(storedLastCitation().label);

watch([lastWorkId, lastLabel], ([workId, label]) => {
    try {
        localStorage.setItem(
            lastCitationKey(),
            JSON.stringify({ workId, label }),
        );
    } catch {
        // Storage unavailable — the in-session memory still works.
    }
});

watch(
    () => layer.value?.id,
    () => {
        const stored = storedLastCitation();
        lastWorkId.value = stored.workId;
        lastLabel.value = stored.label;
    },
);

// Increments the trailing run of digits in a label ("1.5" -> "1.6"). A label
// with no trailing digits (e.g. ends in a letter, like a Stephanus section)
// is returned unchanged — there's no sensible "next" value to guess.
function incrementLabel(label: string): string {
    const match = label.match(/^(.*?)(\d+)$/);

    if (!match) {
        return label;
    }

    const [, prefix, digits] = match;

    return prefix + (parseInt(digits, 10) + 1);
}

/**
 * Keep the remembered selection pointing at the same characters while the
 * text changes around (or under) it. A selection the edit destroyed is
 * cleared — along with any menu that was open for it.
 */
function transformRememberedSelection(ops: TextEditOp[]) {
    if (!activeSelection.value) {
        return;
    }

    const [result] = transformSpans(
        [
            {
                start: activeSelection.value.start,
                end: activeSelection.value.end,
                needsReview: false,
            },
        ],
        ops,
    );

    if (result.deleted || result.end <= result.start) {
        clearSelection();

        return;
    }

    activeSelection.value = {
        start: result.start,
        end: result.end,
        text: codePointSlice(editedText.value, result.start, result.end),
    };
    void nextTick(updateSelectionAnchor);
}

/**
 * Open a selection menu from its floating button — pressing the button, not
 * making the selection, is what asks for the menu. Pending text is flushed
 * first: everything these menus post is offsets into the *saved* text.
 */
function openSelectionMenu(menu: SelectionMenu) {
    if (!activeSelection.value) {
        return;
    }

    void flushText(true).then((ok) => {
        if (!ok || !activeSelection.value) {
            return;
        }

        if (menu === 'assign') {
            prefillAssignForm(
                activeSelection.value.start,
                activeSelection.value.end,
            );
        }

        activeMenu.value = menu;
    });
}

// A selection carrying transcript markup can't be batch-split — a gap has no
// ink to align, and mixing "real" and "guessed" text into one uniform
// division would misplace every unit after it.
const selectionIsSplittable = computed(
    () =>
        !!activeSelection.value && !/[[\]{}_]/.test(activeSelection.value.text),
);

// Text maps to the facsimile once — a selection overlapping an existing
// mapping cannot be mapped again; remapping is remove-then-redraw. The
// server refuses too; this just says so before a box is drawn in vain.
const selectionAlreadyMapped = computed(
    () =>
        !!activeSelection.value &&
        activeRegions.value.some(
            (region) =>
                region.start_offset < activeSelection.value!.end &&
                region.end_offset > activeSelection.value!.start,
        ),
);
type SplitGranularity = 'span' | 'line' | 'word' | 'character';
const splitGranularity = ref<SplitGranularity>('span');

// All selection lookups read the *edited* state — the surface is always
// editable, so comparing against saved offsets would silently target the
// wrong characters the moment anything was typed.
const matchingSegment = computed<TranscriptionSegment | null>(() => {
    if (!activeSelection.value) {
        return null;
    }

    return (
        activeSegments.value.find(
            (segment) =>
                segment.start_offset === activeSelection.value!.start &&
                segment.end_offset === activeSelection.value!.end,
        ) ?? null
    );
});

const overlappingReviewSegment = computed<TranscriptionSegment | null>(() => {
    if (!activeSelection.value || matchingSegment.value) {
        return null;
    }

    return (
        activeSegments.value.find(
            (segment) =>
                segment.needs_review &&
                segment.start_offset < activeSelection.value!.end &&
                segment.end_offset > activeSelection.value!.start,
        ) ?? null
    );
});

// Shared by a fresh drag-selection and a badge click — both land on a span
// of text and remember it; menus open from the floating buttons (or the
// badge), never from the act of selecting itself.
function rememberSelection(start: number, end: number, text: string) {
    activeSelection.value = { start, end, text };

    if (drawingArmed.value) {
        drawingArmed.value = false;
        emit('cancel-drawing');
    }

    regionError.value = null;
    assignError.value = null;
    partPlacement.value = null;
    realignmentWarning.value = null;
}

/** What the assign menu should propose for this span. */
function prefillAssignForm(start: number, end: number) {
    const existing = activeSegments.value.find(
        (segment) =>
            segment.start_offset === start && segment.end_offset === end,
    );

    if (existing) {
        assignForm.work_id = existing.canonical_passage?.work_id ?? '';
        assignForm.label = existing.canonical_passage?.label ?? '';

        return;
    }

    assignForm.work_id = lastWorkId.value;
    assignForm.label = lastLabel.value ? incrementLabel(lastLabel.value) : '';
}

function onTextSelect(selection: ActiveSelection) {
    if (!canEdit.value) {
        return;
    }

    rememberSelection(
        toFull(selection.start),
        toFull(selection.end),
        selection.text,
    );

    // A fresh selection invalidates whatever menu was open for the old one.
    activeMenu.value = null;
    updateSelectionAnchor();
    overlayVisible.value = actionOnSelect.value !== 'none';

    if (actionOnSelect.value !== 'none') {
        openSelectionMenu(actionOnSelect.value);
    }
}

// Fired only for a genuine click into the text (the component filters out
// mouseups on its own badges and controls) — clicking away dismisses the
// selection and whatever menu was open for it.
function onSelectionCleared() {
    clearSelection();
}

function onBadgeClick(segment: TranscriptionSegment) {
    if (!canEdit.value) {
        return;
    }

    if (matchingSegment.value?.id === segment.id && activeMenu.value !== null) {
        clearSelection();

        return;
    }

    // The badge came from the page-scoped segments handed to AlignableText,
    // so its offsets are the page's. Selecting the span gives the floating
    // actions a real selection rectangle to anchor under.
    const start = toFull(segment.start_offset);
    const end = toFull(segment.end_offset);

    rememberSelection(start, end, activeText.value.slice(start, end));
    textEl.value?.selectRangeAt(segment.start_offset, segment.end_offset);
    updateSelectionAnchor();
    prefillAssignForm(start, end);
    overlayVisible.value = true;
    activeMenu.value = 'assign';
}

function clearSelection() {
    activeSelection.value = null;
    activeMenu.value = null;
    selectionAnchor.value = null;
    overlayVisible.value = false;

    if (drawingArmed.value) {
        drawingArmed.value = false;
        emit('cancel-drawing');
    }

    splitGranularity.value = 'span';
    partPlacement.value = null;
    realignmentWarning.value = null;
}

// ---- align to facsimile: arming hands control to the page, which brings
// the facsimile up in the other pane; the drawn box comes back through
// completeRegion below.
function armDrawing(granularity: SplitGranularity) {
    if (!activeSelection.value) {
        return;
    }

    void flushText(true).then((ok) => {
        if (!ok || !activeSelection.value) {
            return;
        }

        splitGranularity.value = granularity;
        drawingArmed.value = true;
        emit('arm-drawing');
    });
}

function cancelDrawing() {
    drawingArmed.value = false;
    emit('cancel-drawing');
}

/** The page calls this with the box drawn on the facsimile opposite. */
function completeRegion(
    box: { x: number; y: number; width: number; height: number },
    imageId: number,
) {
    const selection = activeSelection.value;

    if (!selection || !layer.value) {
        return;
    }

    regionError.value = null;

    const onFailure = (errors: Record<string, string>) => {
        regionError.value =
            Object.values(errors)[0] ??
            'Could not save that alignment. Try drawing the box again.';
    };
    const done = () => {
        drawingArmed.value = false;
        clearSelection();
    };

    if (splitGranularity.value === 'span') {
        router.post(
            storeRegion.url(layer.value.id),
            {
                manuscript_image_id: imageId,
                text: selection.text,
                start_offset: selection.start,
                end_offset: selection.end,
                ...box,
            },
            { preserveScroll: true, onSuccess: done, onError: onFailure },
        );

        return;
    }

    // Draw one guide box over the whole selection; the server divides it
    // into one band per line of the selection and one region per
    // word/character within each, widths following character counts — an
    // approximation to fine-tune afterward, not letter detection.
    router.post(
        storeRegionBatch.url(layer.value.id),
        {
            manuscript_image_id: imageId,
            granularity: splitGranularity.value,
            start_offset: selection.start,
            end_offset: selection.end,
            ...box,
        },
        { preserveScroll: true, onSuccess: done, onError: onFailure },
    );
}

/**
 * Place (or move) the given page to begin at the current selection — the
 * Pages box between the panes calls this on whichever pane holds a
 * selection.
 */
function placePage(pageId: number) {
    if (!layer.value || !activeSelection.value) {
        return;
    }

    // Offsets are posted against the saved text — flush pending edits first.
    void flushText(true).then((ok) => {
        if (!ok || !layer.value || !activeSelection.value) {
            return;
        }

        router.post(
            storePageBreak.url(layer.value),
            {
                manuscript_page_id: pageId,
                start_offset: activeSelection.value.start,
            },
            { preserveScroll: true, onSuccess: () => clearSelection() },
        );
    });
}

// ---- citation assignment ----
// How many spans cite each passage across the whole layer, so badges can
// mark the parts of a split-cited passage even when a sibling part sits on
// another page.
const layerPartTotals = computed<Record<number, number>>(() => {
    const totals: Record<number, number> = {};

    for (const segment of layerSegments.value) {
        totals[segment.canonical_passage_id] =
            (totals[segment.canonical_passage_id] ?? 0) + 1;
    }

    return totals;
});

// The spans this layer already has for the passage the form currently names
// (excluding the one being re-cited, if any), in content order. Non-empty
// means saving adds another *part* of that passage rather than a new one —
// the witness's text for it is discontinuous, a transposition split it.
const existingParts = computed<TranscriptionSegment[]>(() => {
    if (!assignForm.work_id || !assignForm.label) {
        return [];
    }

    return activeSegments.value
        .filter(
            (segment) =>
                segment.canonical_passage?.work_id === assignForm.work_id &&
                segment.canonical_passage?.label === assignForm.label &&
                segment.id !== matchingSegment.value?.id,
        )
        .sort((a, b) => a.part - b.part || a.start_offset - b.start_offset);
});

// Where in the passage's content order the new part goes: a part number to
// follow (0 = first), or null to read last. Only sent when parts exist.
const partPlacement = ref<number | null>(null);

// The server refuses a save that would touch this witness's existing
// collation until acknowledged; its message says exactly what saving will
// do (re-collate, or keep-and-flag). Held here to show a proceed/cancel
// choice instead of a bare error.
const realignmentWarning = ref<string | null>(null);

// A span is always marked and cited in the same action — a span with no
// citation would have no use to anyone, so there's no "assign later" step.
// Pending text is flushed first: the offsets posted must be into the saved
// text.
function assignSelection(acknowledgeRealignment = false) {
    void flushText(true).then((ok) => {
        if (ok) {
            postAssignment(acknowledgeRealignment);
        }
    });
}

function postAssignment(acknowledgeRealignment: boolean) {
    if (!activeSelection.value || !assignForm.work_id || !assignForm.label) {
        return;
    }

    assignError.value = null;
    realignmentWarning.value = null;

    const workId = assignForm.work_id;
    const label = assignForm.label;
    const partFields =
        existingParts.value.length > 0
            ? {
                  after_part: partPlacement.value,
                  acknowledge_realignment: acknowledgeRealignment,
              }
            : {};
    const rememberChoice = () => {
        lastWorkId.value = workId;
        lastLabel.value = label;
    };
    const onFailure = (errors: Record<string, string>) => {
        if (errors.acknowledge_realignment) {
            realignmentWarning.value = errors.acknowledge_realignment;

            return;
        }

        assignError.value =
            Object.values(errors)[0] ?? 'Could not assign that citation.';
    };

    if (matchingSegment.value) {
        router.patch(
            assignCitationRoute.url(matchingSegment.value.id),
            { work_id: workId, label, ...partFields },
            {
                preserveScroll: true,
                onSuccess: () => {
                    rememberChoice();
                    clearSelection();
                },
                onError: onFailure,
            },
        );

        return;
    }

    const selection = activeSelection.value;

    router.post(
        storeSegment.url(layer.value!.id),
        {
            start_offset: selection.start,
            end_offset: selection.end,
            work_id: workId,
            label,
            ...partFields,
        },
        {
            preserveScroll: true,
            onSuccess: () => {
                rememberChoice();
                clearSelection();
            },
            onError: onFailure,
        },
    );
}

function removeSegment(segmentId: number) {
    router.delete(destroySegment.url(segmentId), {
        preserveScroll: true,
        onSuccess: () => clearSelection(),
    });
}

function fixBoundaries() {
    if (!activeSelection.value || !overlappingReviewSegment.value) {
        return;
    }

    // Offsets are posted against the saved text — flush pending edits first.
    void flushText(true).then((ok) => {
        if (!ok || !activeSelection.value || !overlappingReviewSegment.value) {
            return;
        }

        router.patch(
            updateSegment.url(overlappingReviewSegment.value.id),
            {
                start_offset: activeSelection.value.start,
                end_offset: activeSelection.value.end,
            },
            { preserveScroll: true, onSuccess: () => clearSelection() },
        );
    });
}

defineExpose({
    flushAll: () => flushText(true),
    completeRegion,
    placePage,
    hasSelection: () => activeSelection.value !== null,
    clearSelection,
});
</script>

<template>
    <div>
        <!-- Row 1: which transcript and layer, its visibility, its removal. -->
        <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <select
                :value="currentValue"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                @change="onPickLayer"
            >
                <optgroup
                    v-for="transcript in props.transcripts"
                    :key="transcript.id"
                    :label="transcript.name"
                >
                    <option
                        v-for="option in transcript.layers ?? []"
                        :key="option.id"
                        :value="`layer-${option.id}`"
                        :disabled="option.id === props.otherLayerId"
                    >
                        {{ option.layer }}
                    </option>
                </optgroup>
            </select>

            <select
                v-if="canEdit && layer"
                v-model="visibility"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                @change="saveVisibility"
            >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
            </select>
            <span v-else-if="layer" class="text-stone-500 dark:text-stone-400">
                {{ layer.transcription?.visibility }}
            </span>

            <button
                v-if="canEdit && layer"
                type="button"
                class="text-red-600 underline dark:text-red-400"
                @click="removeTranscript"
            >
                Delete transcript
            </button>
        </div>

        <!-- Row 2: import, copy, and the layer-correspondence report. -->
        <div
            v-if="layer"
            class="mb-2 flex flex-wrap items-center gap-2 text-xs"
        >
            <button
                v-if="canEdit"
                type="button"
                class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                @click="importing = !importing"
            >
                {{ importing ? 'Cancel import' : 'Import file' }}
            </button>
            <button
                v-if="canEdit"
                type="button"
                class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                @click="openCopyPage"
            >
                Copy layer&hellip;
            </button>

            <!-- The two layers must carry the same words in the same lines
                 (normalization changes only characters within a word).
                 Divergence is an editing state to resolve, and this is where
                 it becomes visible. -->
            <span
                v-if="props.pane.correspondence"
                :class="
                    props.pane.correspondence.divergence
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-stone-400 dark:text-stone-600'
                "
                :title="
                    props.pane.correspondence.divergence
                        ? `This layer has ${props.pane.correspondence.divergence.a_words ?? 'no'} word(s) on line ${props.pane.correspondence.divergence.line}, the ${props.pane.correspondence.sibling} layer ${props.pane.correspondence.divergence.b_words ?? 'none'} — both layers should carry the same words in the same lines.`
                        : 'Both layers carry the same words in the same lines.'
                "
            >
                {{
                    props.pane.correspondence.divergence
                        ? `layers differ at line ${props.pane.correspondence.divergence.line}`
                        : 'layers in step'
                }}
            </span>
        </div>

        <div
            v-if="canEdit && importing && layer"
            class="mb-2 flex flex-wrap items-center gap-2 rounded border border-stone-200 p-2 text-xs dark:border-stone-800"
        >
            <span class="text-stone-500 dark:text-stone-400">
                Insert a plain-text file at the cursor, into the
                {{ layer.layer }} layer:
            </span>
            <input type="file" accept=".txt,text/plain" @change="importFile" />
            <span class="text-stone-500 dark:text-stone-400">
                It appears as an unsaved edit, like anything typed.
            </span>
            <span
                v-if="importError"
                class="w-full text-red-600 dark:text-red-400"
                >{{ importError }}</span
            >
        </div>

        <!-- Row 3: strip-from-selection. -->
        <div
            v-if="canEdit && layer"
            class="mb-2 flex flex-wrap items-center gap-2 text-xs"
        >
            <span class="text-stone-500 dark:text-stone-400"
                >Strip from selection:</span
            >
            <button
                v-for="kind in [
                    'accents',
                    'breathings',
                    'diacritics',
                    'punctuation',
                ] as const"
                :key="kind"
                type="button"
                class="rounded border border-stone-300 px-2 py-0.5 disabled:opacity-40 dark:border-stone-700"
                :disabled="!activeSelection"
                :title="
                    activeSelection
                        ? undefined
                        : 'Select a stretch of text first'
                "
                @mousedown.prevent
                @click="stripFromSelection(kind)"
            >
                {{ kind }}
            </button>
        </div>

        <!-- Row 4: what selecting does, the save state, undo/redo. -->
        <div
            v-if="canEdit && layer"
            class="mb-2 flex flex-wrap items-center gap-2 text-xs"
        >
            <label
                class="flex items-center gap-1 text-stone-500 dark:text-stone-400"
                title="What making a selection does, beyond selecting"
            >
                Action on select:
                <select
                    v-model="actionOnSelect"
                    class="rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                >
                    <option value="none">None</option>
                    <option value="align">Map to facsimile</option>
                    <option value="assign">Assign to segment in work</option>
                </select>
            </label>
            <span
                class="ml-auto inline-block h-2.5 w-2.5 rounded-full"
                :class="
                    !savingText && !unsavedOps ? 'bg-green-600' : 'bg-red-600'
                "
                :title="
                    savingText
                        ? 'Saving…'
                        : unsavedOps
                          ? 'Unsaved changes'
                          : 'All changes saved'
                "
            ></span>
            <button
                type="button"
                class="rounded border border-stone-300 px-2 py-1 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:text-stone-400"
                :disabled="!canUndo"
                title="Undo (Ctrl+Z)"
                @mousedown.prevent
                @click="performUndo"
            >
                Undo
            </button>
            <button
                type="button"
                class="rounded border border-stone-300 px-2 py-1 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:text-stone-400"
                :disabled="!canRedo"
                title="Redo (Ctrl+Shift+Z)"
                @mousedown.prevent
                @click="performRedo"
            >
                Redo
            </button>
        </div>

        <div
            v-if="canEdit && layer"
            class="mb-2 flex flex-col gap-1 text-xs empty:hidden"
        >
            <span
                v-if="needsDeleteConfirmation"
                class="flex items-center gap-2 text-red-600 dark:text-red-400"
            >
                <label class="flex items-center gap-1">
                    <input v-model="deleteConfirmed" type="checkbox" />
                    This will remove
                    <template
                        v-if="wouldDeleteAllSegments && wouldDeleteAllRegions"
                        >every citation and image alignment</template
                    ><template v-else-if="wouldDeleteAllSegments"
                        >every citation</template
                    ><template v-else>every image alignment</template>
                    on this transcript — save anyway
                </label>
            </span>
            <span v-if="textSaveError" class="text-red-600 dark:text-red-400">{{
                textSaveError
            }}</span>
            <span
                v-if="staleTextError"
                class="flex flex-wrap items-center gap-2 rounded border border-red-300 bg-white px-2 py-1 text-red-700 dark:border-red-800 dark:bg-stone-900 dark:text-red-400"
            >
                <span>{{ staleTextError }}</span>
                <button
                    type="button"
                    class="underline"
                    @click="reloadAfterConflict"
                >
                    Reload
                </button>
            </span>
            <span
                v-if="textSaveNotice"
                class="rounded border border-sky-300 bg-white px-2 py-1 text-sky-800 dark:border-sky-800 dark:bg-stone-900 dark:text-sky-300"
            >
                {{ textSaveNotice }}
            </span>
        </div>

        <p
            v-if="layer && !canEdit"
            class="mb-2 text-xs text-stone-500 dark:text-stone-400"
        >
            Click a citation badge for details.
        </p>

        <!-- The text, with the floating selection actions anchored under the
             selection's last line. The overlay is a SIBLING of the editable
             surface, absolutely positioned — nothing is ever inserted into
             the text flow, so no line ever breaks for it. -->
        <div
            ref="textWrapEl"
            class="relative max-h-[45rem] overflow-y-auto font-serif text-lg leading-loose"
        >
            <AlignableText
                ref="textEl"
                :text="pageText"
                :regions="pageRegions"
                :segments="pageSegments"
                :part-totals="layerPartTotals"
                :highlighted-region-id="props.hoveredRegionId"
                :editable="canEdit"
                @select="onTextSelect"
                @selection-cleared="onSelectionCleared"
                @hover-region="(id) => emit('hover-region', id)"
                @badge-click="onBadgeClick"
                @edit="onEdit"
                @undo="performUndo"
                @redo="performRedo"
            />

            <div
                v-if="
                    canEdit &&
                    overlayVisible &&
                    activeSelection &&
                    selectionAnchor
                "
                class="absolute z-10 flex max-w-80 flex-col gap-2 rounded border border-sky-200 bg-sky-50 p-2 font-sans text-xs shadow-sm dark:border-sky-900 dark:bg-sky-950"
                :style="{
                    top: `${selectionAnchor.top + 4}px`,
                    left: `${selectionAnchor.left}px`,
                }"
            >
                <!-- Only the dialogue the Action-on-select dropdown (or a
                     badge click) asked for — no mode switching in here. -->
                <span class="flex items-center justify-between gap-2">
                    <span class="text-stone-500 dark:text-stone-400">
                        {{
                            activeMenu === 'align'
                                ? 'Map to facsimile'
                                : 'Assign to segment in work'
                        }}
                    </span>
                    <button
                        type="button"
                        class="text-stone-500 underline"
                        @mousedown.prevent
                        @click="clearSelection"
                    >
                        Clear
                    </button>
                </span>

                <span
                    v-if="overlappingReviewSegment"
                    class="rounded border border-dashed border-red-400 p-2"
                >
                    <span class="mb-1 block text-red-600 dark:text-red-400">
                        This overlaps a span flagged for review (its text
                        changed underneath it).
                    </span>
                    <button
                        type="button"
                        class="rounded bg-red-600 px-2 py-0.5 text-white"
                        @click="fixBoundaries"
                    >
                        Update that span to this selection
                    </button>
                </span>

                <template v-if="activeMenu === 'align'">
                    <span
                        v-if="selectionAlreadyMapped"
                        class="text-amber-700 dark:text-amber-400"
                    >
                        Part of this selection is already mapped to the
                        facsimile — remove the existing mapping first.
                    </span>
                    <span v-else-if="drawingArmed">
                        Drag a box on the facsimile opposite to place
                        <template v-if="splitGranularity === 'span'"
                            >this text.</template
                        ><template v-else-if="splitGranularity === 'line'"
                            >it — one region per line of the selection, stacked
                            down the box.</template
                        ><template v-else
                            >it — one region per {{ splitGranularity }}, sized
                            by letter count; each line of the selection takes
                            its own row of the box.</template
                        >
                        <button
                            type="button"
                            class="ml-1 underline"
                            @click="cancelDrawing"
                        >
                            Cancel
                        </button>
                    </span>
                    <span v-else class="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            class="self-start text-stone-700 underline dark:text-stone-300"
                            @click="armDrawing('span')"
                        >
                            as one box
                        </button>
                        <!-- No markup gate: a whole line fills its band, so a
                             gap can't misplace anything — line-mapping stays
                             available exactly where gapped text makes
                             word-splitting unavailable. -->
                        <button
                            type="button"
                            class="self-start text-stone-700 underline dark:text-stone-300"
                            @click="armDrawing('line')"
                        >
                            split by line
                        </button>
                        <button
                            type="button"
                            class="self-start text-stone-700 underline disabled:opacity-40 dark:text-stone-300"
                            :disabled="!selectionIsSplittable"
                            :title="
                                selectionIsSplittable
                                    ? undefined
                                    : 'Contains transcript markup — split a plain-text selection instead'
                            "
                            @click="armDrawing('word')"
                        >
                            split by word
                        </button>
                        <button
                            type="button"
                            class="self-start text-stone-700 underline disabled:opacity-40 dark:text-stone-300"
                            :disabled="!selectionIsSplittable"
                            :title="
                                selectionIsSplittable
                                    ? undefined
                                    : 'Contains transcript markup — split a plain-text selection instead'
                            "
                            @click="armDrawing('character')"
                        >
                            split by character
                        </button>
                    </span>
                    <span
                        v-if="regionError"
                        class="text-red-600 dark:text-red-400"
                    >
                        {{ regionError }}
                    </span>
                </template>

                <template v-else-if="activeMenu === 'assign'">
                    <span
                        v-if="matchingSegment?.needs_review"
                        class="text-red-600 dark:text-red-400"
                    >
                        Flagged for review — the text here changed since this
                        was mapped.
                    </span>
                    <span
                        v-if="existingParts.length > 0 && !realignmentWarning"
                        class="flex flex-wrap items-center gap-2 text-sky-700 dark:text-sky-400"
                    >
                        <span>
                            This layer already cites
                            {{ assignForm.label }} — this span becomes another
                            part of it, reading
                        </span>
                        <select
                            v-model="partPlacement"
                            class="rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                        >
                            <option :value="null">last</option>
                            <option :value="0">first</option>
                            <option
                                v-for="sibling in existingParts.slice(0, -1)"
                                :key="sibling.id"
                                :value="sibling.part"
                            >
                                after part
                                {{ sibling.part }}
                            </option>
                        </select>
                    </span>
                    <span
                        v-if="realignmentWarning"
                        class="flex flex-wrap items-center gap-2"
                    >
                        <span class="text-amber-700 dark:text-amber-400">
                            {{ realignmentWarning }}
                        </span>
                        <button
                            type="button"
                            class="rounded bg-stone-900 px-2 py-0.5 text-white dark:bg-stone-100 dark:text-stone-900"
                            @click="assignSelection(true)"
                        >
                            Save anyway
                        </button>
                        <button
                            type="button"
                            class="underline"
                            @click="realignmentWarning = null"
                        >
                            Cancel
                        </button>
                    </span>
                    <span
                        v-if="!realignmentWarning"
                        class="flex flex-wrap items-center gap-2"
                    >
                        <select
                            v-model="assignForm.work_id"
                            class="rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                        >
                            <option value="" disabled>Work&hellip;</option>
                            <option
                                v-for="work in props.works"
                                :key="work.id"
                                :value="work.id"
                            >
                                {{ work.title }}
                            </option>
                        </select>
                        <input
                            v-model="assignForm.label"
                            type="text"
                            placeholder="e.g. 45 or 45A"
                            class="w-24 rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                        />
                        <button
                            type="button"
                            class="rounded bg-stone-900 px-2 py-0.5 text-white dark:bg-stone-100 dark:text-stone-900"
                            @click="assignSelection()"
                        >
                            {{
                                matchingSegment
                                    ? 'Update citation'
                                    : existingParts.length > 0
                                      ? 'Add as part'
                                      : 'Mark & assign'
                            }}
                        </button>
                        <!-- Moving a passage is plain cut & paste: the
                             citation travels with the words. -->
                        <button
                            v-if="matchingSegment"
                            type="button"
                            class="text-red-600 underline dark:text-red-400"
                            @click="removeSegment(matchingSegment.id)"
                        >
                            Remove span
                        </button>
                    </span>
                    <span
                        v-if="assignError"
                        class="text-red-600 dark:text-red-400"
                    >
                        {{ assignError }}
                    </span>
                </template>
            </div>
        </div>
    </div>
</template>
