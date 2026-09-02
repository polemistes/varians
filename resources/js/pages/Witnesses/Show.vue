<script setup lang="ts">
import { Head, router, useForm, usePage } from '@inertiajs/vue3';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import AlignableText from '@/components/AlignableText.vue';
import AppHeader from '@/components/AppHeader.vue';
import ManuscriptImageViewer from '@/components/ManuscriptImageViewer.vue';
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
import { store as storeImage } from '@/routes/manuscript-images';
import {
    destroy as destroyManuscriptPage,
    store as storeManuscriptPage,
} from '@/routes/manuscript-pages';
import { store as storePageBreak } from '@/routes/transcription-page-breaks';
import {
    destroy as destroyRegion,
    store as storeRegion,
    storeBatch as storeRegionBatch,
    update as updateRegion,
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
import {
    show as showWitnessRoute,
    update as updateWitness,
} from '@/routes/witnesses';
import { destroy as destroyWitness } from '@/routes/witnesses';
import { store as storeTranscriptionRoute } from '@/routes/witnesses/transcriptions';
import type { Auth } from '@/types/auth';
import type {
    Transcription,
    TranscriptionLayer,
    TranscriptionPageBreak,
    TranscriptionRegion,
    TranscriptionSegment,
    Witness,
    Work,
} from '@/types/models';

const props = defineProps<{
    witness: Witness;
    /** Every transcription of this witness, for the picker. */
    transcriptions: Transcription[];
    /** The layer being worked on, or null when the witness has none yet. */
    transcription: TranscriptionLayer | null;
    /** Where each page begins, in lines — shared by both layers. */
    pageBreaks: TranscriptionPageBreak[];
    /**
     * Whether this layer and its sibling still share the word skeleton
     * normalization preserves — null when there is nothing to compare.
     */
    layerCorrespondence: {
        sibling: string;
        text: string;
        divergence: {
            line: number;
            a_words: number | null;
            b_words: number | null;
        } | null;
    } | null;
    works: Work[];
}>();

// A witness may have no transcription at all, so everything below reads the
// layer through these rather than assuming one is open. The pane is only
// rendered when there is one; these keep the script total anyway, so a
// half-loaded page cannot throw.
const layer = computed(() => props.transcription);
const layerText = computed(() => layer.value?.text ?? '');
const layerSegments = computed(() => layer.value?.segments ?? []);
const layerRegions = computed(() => layer.value?.regions ?? []);

const page = usePage<{
    auth: Auth;
    flash?: { message?: string | null };
}>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

const markupLegend =
    '[abc] restored · [3] / [?] lost, extent known/unknown · ' +
    '{3} / {?} illegible, extent known/unknown · _abc_ uncertain reading';

function removeWitness() {
    const parts = describeDeletionImpact(props.witness.deletion_impact, [
        {
            key: 'transcriptions',
            label: (n) => pluralize(n, 'transcription'),
        },
        { key: 'segments', label: (n) => pluralize(n, 'citation') },
        { key: 'regions', label: (n) => pluralize(n, 'image alignment') },
        { key: 'images', label: (n) => pluralize(n, 'manuscript image') },
        { key: 'pages', label: (n) => pluralize(n, 'manuscript page') },
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

    if (!confirmDeletion(`witness ${props.witness.siglum}`, parts)) {
        return;
    }

    router.delete(destroyWitness.url(props.witness));
}

/** Repository and shelfmark as one line, empty parts simply absent. */
const witnessLocation = computed(
    () =>
        [props.witness.repository, props.witness.shelfmark]
            .filter(Boolean)
            .join(', ') || null,
);

// ---- editing the witness ----
const editingWitness = ref(false);
const showDescription = ref(false);
const witnessForm = useForm({
    siglum: props.witness.siglum,
    label: props.witness.label ?? '',
    date_text: props.witness.date_text ?? '',
    repository: props.witness.repository ?? '',
    shelfmark: props.witness.shelfmark ?? '',
    description: props.witness.description ?? '',
});

function saveWitness() {
    witnessForm
        .transform((data) => ({
            siglum: data.siglum,
            label: data.label || null,
            date_text: data.date_text || null,
            repository: data.repository || null,
            shelfmark: data.shelfmark || null,
            description: data.description || null,
        }))
        .patch(updateWitness.url(props.witness.id), {
            preserveScroll: true,
            onSuccess: () => (editingWitness.value = false),
        });
}

function cancelWitnessEdit() {
    witnessForm.reset();
    witnessForm.clearErrors();
    editingWitness.value = false;
}

function removeTranscription() {
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

    if (!confirmDeletion('this transcription', parts)) {
        return;
    }

    if (layer.value) {
        router.delete(destroyTranscription.url(layer.value));
    }
}

// A plain ref (not a separate useForm) so this always PATCHes the *current*
// visibility — a useForm's initial state is captured once at setup and would
// go stale if it captured the transcription's visibility instead.
const visibility = ref(
    props.transcription?.transcription?.visibility ?? 'draft',
);

function saveVisibility() {
    router.patch(
        updateTranscription.url(layer.value!),
        { visibility: visibility.value },
        { preserveScroll: true },
    );
}

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

type PageEditSource = EditSource | 'atomic';

function applyEdit(op: TextEditOp, source: PageEditSource) {
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

function onEdit(op: TextEditOp, source: PageEditSource = 'typing') {
    // Typed inside the page, recorded against the whole text — that is what
    // the server replays and what every other offset is measured in.
    applyEdit(
        { start: toFull(op.start), end: toFull(op.end), text: op.text },
        source,
    );
}

/**
 * Queue the edits that strip a class of marks from the whole text — one
 * undo step, however many ops it takes.
 *
 * Goes through the same pending-ops mechanism as typing, rather than
 * replacing the text outright: every citation span, image region and collated
 * reading is recorded as offsets into this text, and a wholesale replacement
 * would read as "all of it changed" and flag or destroy them.
 */
function stripMarks(kind: StripKind) {
    const ops = stripOps(editedText.value, kind);

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
                only: [
                    'transcription',
                    'pageBreaks',
                    'layerCorrespondence',
                    'flash',
                ],
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
    },
);

// ---- manuscript images ----
const images = computed(() => props.witness.images ?? []);

// Which leaf is on the right follows from which page is on the left — see the
// page block below, where a watcher keeps this pointing at a photograph of the
// selected page. A page may have several (recto shot twice, a detail), so it
// stays a choice within the page rather than being derived outright.
const selectedImageId = ref<number | null>(null);

const selectedImage = computed(
    () =>
        images.value.find((image) => image.id === selectedImageId.value) ??
        null,
);
const featuresForSelectedImage = computed(
    () => selectedImage.value?.features ?? [],
);

const hoveredRegionId = ref<number | null>(null);
const editableRegionId = ref<number | null>(null);
const regionsForSelectedImage = computed(() =>
    activeRegions.value.filter(
        (region) => region.manuscript_image_id === selectedImageId.value,
    ),
);

function selectRegionForEditing(id: number) {
    if (!canEdit.value) {
        return;
    }

    editableRegionId.value = editableRegionId.value === id ? null : id;
}

function onRegionMoved(
    id: number,
    box: { x: number; y: number; width: number; height: number },
) {
    router.patch(updateRegion.url(id), box, { preserveScroll: true });
}

const imageUploadForm = useForm<{ folio_label: string; image: File | null }>({
    folio_label: '',
    image: null,
});

function onImageFileChange(event: Event) {
    imageUploadForm.image =
        (event.target as HTMLInputElement).files?.[0] ?? null;
}

function uploadImage() {
    imageUploadForm.post(storeImage.url(props.witness.id), {
        preserveScroll: true,
        onSuccess: () => imageUploadForm.reset(),
    });
}

// ---- selection: the text pane is one always-editable surface. Selecting is
// just selecting — the toolbar's "Assign selection…" / "Map selection to
// facsimile" buttons act on the current selection when *pressed*, instead of
// a menu popping up the instant a selection exists. `activeMenu` is which
// contextual menu is open for the current selection; a citation badge click
// always opens "assign".
type SelectionMenu = 'align' | 'assign';
const activeMenu = ref<SelectionMenu | null>(null);

// The menu renders above the text pane; a flow that starts far down in a
// long transcription (a badge click) brings it into view when it opens.
// 'nearest' makes this a no-op when it's already visible.
const selectionMenuEl = ref<HTMLElement | null>(null);

watch(activeMenu, (menu) => {
    if (menu !== null) {
        void nextTick(() =>
            selectionMenuEl.value?.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
            }),
        );
    }
});

// The text/segments/regions actually rendered: always the live-edited local
// state, so highlighted spans (and tombstones) visibly move as the scholar
// types. With an empty op log these equal exactly what's persisted.
const activeText = computed(() => editedText.value);
const activeSegments = computed(() => editedSegments.value);
const activeRegions = computed(() => editedRegions.value);

// ---- pages ----
// The left pane shows only the text standing on the page being worked on, so
// that it reads beside the leaf on the right rather than as one long scroll.
//
// A page runs from its own break to the next one — see TranscriptionPageBreak
// — and text before the first break belongs to no page yet. Everything else in
// this component works in whole-text offsets, so the slice is converted at
// exactly two places inbound (a selection, an edit) and at the props handed to
// AlignableText outbound. `toFull` and `toPage` are the only conversions.
const pages = computed(() => props.witness.pages ?? []);

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

// The division is held in lines on the transcription, because that is the one
// coordinate both layers share: their character offsets differ, but a line of
// the transcription is a line of the manuscript in either. Each layer resolves
// it against its own text here.
const breaks = computed(() =>
    [...props.pageBreaks]
        .sort((a, b) => a.start_line - b.start_line)
        .map((item) => ({
            ...item,
            start_offset: offsetOfLine(activeText.value, item.start_line),
        })),
);

const selectedPageId = ref<number | null>(null);

/** The break for the selected page, if that page has been placed here. */
const selectedBreak = computed(
    () =>
        breaks.value.find(
            (item) => item.manuscript_page_id === selectedPageId.value,
        ) ?? null,
);

const pageStart = computed(() => selectedBreak.value?.start_offset ?? 0);

const pageEnd = computed(() => {
    // The stretch before the first page begins, which belongs to no page yet.
    if (selectedPageId.value === null) {
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

/** Whether the selected page has been placed in this layer at all. */
const selectedPageIsPlaced = computed(() => selectedBreak.value !== null);

/**
 * Whether any text stands before the first page begins. Shown as its own entry
 * rather than being what an unplaced page falls back to — "this page has no
 * break yet" and "this text is on no page yet" are different things.
 */
const hasUnplacedOpening = computed(
    () => breaks.value.length > 0 && breaks.value[0].start_offset > 0,
);

const firstPlacedPageLabel = computed(() => {
    const first = breaks.value[0];

    return first
        ? (pages.value.find((page) => page.id === first.manuscript_page_id)
              ?.label ?? null)
        : null;
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

const selectedPage = computed(
    () => pages.value.find((page) => page.id === selectedPageId.value) ?? null,
);

// The image shown on the right is the one photographing the page on the left.
// A page may have none — plenty are transcribed from a facsimile — in which
// case the right pane says so rather than showing another page's leaf.
const imagesForSelectedPage = computed(() =>
    images.value.filter(
        (image) => image.manuscript_page_id === selectedPageId.value,
    ),
);

// Open on the first page this layer actually places, so an editor lands where
// the text is rather than on a leaf that has none. Falls back to the first
// page of the manuscript, and to nothing at all when none are recorded.
watch(
    [pages, breaks],
    ([currentPages, currentBreaks]) => {
        const stillThere = currentPages.some(
            (page) => page.id === selectedPageId.value,
        );

        if (stillThere) {
            return;
        }

        selectedPageId.value =
            currentBreaks[0]?.manuscript_page_id ?? currentPages[0]?.id ?? null;
    },
    { immediate: true },
);

// The leaf follows the page. Freshly uploaded images arrive by a normal prop
// reload, and this picks them up with everything else.
watch(
    imagesForSelectedPage,
    (current) => {
        const stillThere = current.some(
            (image) => image.id === selectedImageId.value,
        );

        if (!stillThere) {
            selectedImageId.value = current[0]?.id ?? null;
        }
    },
    { immediate: true },
);

/** Pages this layer has actually placed, as against merely recorded. */
const placedPageIds = computed(() =>
    breaks.value.map((item) => item.manuscript_page_id),
);

// Which transcription and which layer are in the URL, since the server has to
// load that layer's segments, regions and breaks — so choosing is a visit
// rather than local state.
function openTranscription(id: number) {
    router.get(
        showWitnessRoute.url(props.witness),
        { transcription: id },
        { preserveScroll: true },
    );
}

function openLayer(name: string) {
    if (!layer.value || layer.value.layer === name) {
        return;
    }

    // Autosave leaves nothing to discard — flush whatever is pending, then
    // navigate. Only a stale-text conflict blocks, and that needs the reload
    // this visit performs anyway.
    void flushText(true).then(() => {
        router.get(
            showWitnessRoute.url(props.witness),
            { transcription: layer.value!.transcription_id, layer: name },
            { preserveScroll: true },
        );
    });
}

// The copy page posts this layer's saved text, so what is on screen must be
// what the server has: flush-then-navigate, like openLayer.
function openCopyPage() {
    if (!layer.value) {
        return;
    }

    void flushText(true).then(() => {
        router.get(createLayerCopy.url(layer.value!.id));
    });
}

// Importing is an insertion, not a separate kind of operation: the file's text
// goes in at the caret and becomes a pending edit like anything typed, so it
// previews before it is saved and every citation span, image region, page
// division and collated reading moves with it through the usual machinery.
// Nothing is asked — not the layer, which is the one on screen, nor the work,
// which follows later from the citations assigned to the text.
const importing = ref(false);
const importError = ref<string | null>(null);
const textEl = ref<{
    caretOffset: () => number | null;
    restoreCaretAt: (offset: number) => void;
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

function addTranscription() {
    const name = window.prompt(
        'What is this transcription of? (e.g. "Main text", "Scholia")',
        'Transcription',
    );

    if (name === null) {
        return;
    }

    router.post(storeTranscriptionRoute.url(props.witness), {
        name: name.trim() || 'Transcription',
    });
}

/**
 * Place the selected page at the current selection, or move it there.
 *
 * A page begins somewhere and runs to the next break, so saying where it
 * starts is the whole of dividing the text — see TranscriptionPageBreak.
 */
function startPageHere() {
    if (
        !layer.value ||
        !activeSelection.value ||
        selectedPageId.value === null
    ) {
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
                manuscript_page_id: selectedPageId.value,
                start_offset: activeSelection.value.start,
            },
            { preserveScroll: true, onSuccess: () => clearSelection() },
        );
    });
}

const newPageLabel = ref('');

function addPage() {
    if (!newPageLabel.value.trim()) {
        return;
    }

    router.post(
        storeManuscriptPage.url(props.witness.id),
        { label: newPageLabel.value.trim() },
        { preserveScroll: true, onSuccess: () => (newPageLabel.value = '') },
    );
}

function selectPage(id: number | null) {
    selectedPageId.value = id;
    clearSelection();
}

// Deleting cascades server-side: the page's photographs (with their
// alignments) and every layer's break at it go too — the text itself is
// untouched, it simply stops being divided there.
function deleteSelectedPage() {
    const page = selectedPage.value;

    if (!page) {
        return;
    }

    const confirmed = window.confirm(
        `Delete page ${page.label}? Its photographs and every layer's division at it are deleted too. The text itself is kept.`,
    );

    if (!confirmed) {
        return;
    }

    router.delete(destroyManuscriptPage.url(page.id), {
        preserveScroll: true,
    });
}

type ActiveSelection = { start: number; end: number; text: string };
const activeSelection = ref<ActiveSelection | null>(null);
const drawingActive = ref(false);
const regionError = ref<string | null>(null);
const assignError = ref<string | null>(null);

const assignForm = useForm({ work_id: '' as number | '', label: '' });

// Remembered across selections so a scholar marking up a run of consecutive
// lines doesn't have to re-pick the work and retype the next line number
// each time. Persisted per layer in localStorage: citing a manuscript is
// multi-session work, and losing the running line number to a reload (which
// the in-memory version silently did) reads as the feature being broken.
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
}

/**
 * Open a selection menu from its toolbar button — pressing the button, not
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

// A selection carrying transcription markup can't be batch-split — a gap
// has no ink to align, and mixing "real" and "guessed" text into one
// uniform division would misplace every unit after it.
const selectionIsSplittable = computed(
    () =>
        !!activeSelection.value && !/[[\]{}_]/.test(activeSelection.value.text),
);
type SplitGranularity = 'span' | 'line' | 'word' | 'character';
const splitGranularity = ref<SplitGranularity>('span');

// All selection lookups read the *edited* state — the surface is always
// editable now, so comparing against saved offsets would silently target the
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
// of text and remember it; menus open from the toolbar buttons (or the
// badge), never from the act of selecting itself.
function rememberSelection(start: number, end: number, text: string) {
    activeSelection.value = { start, end, text };
    drawingActive.value = false;
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
}

// Fired only for a genuine click into the text (the component filters out
// mouseups on its own badges and menu controls) — clicking away dismisses
// the selection and whatever menu was open for it.
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
    // so its offsets are the page's.
    const start = toFull(segment.start_offset);
    const end = toFull(segment.end_offset);

    rememberSelection(start, end, activeText.value.slice(start, end));
    prefillAssignForm(start, end);
    activeMenu.value = 'assign';
}

function clearSelection() {
    activeSelection.value = null;
    activeMenu.value = null;
    drawingActive.value = false;
    splitGranularity.value = 'span';
    partPlacement.value = null;
    realignmentWarning.value = null;
}

// ---- the right pane: manuscript leaf, or the sibling layer beside this one ----
// The side-by-side layer view is the recovery path when the word-structure
// indicator says the layers have drifted: the same page of the OTHER layer,
// read-only, with the diverging line marked — fix whichever side is wrong
// without switching layers back and forth from memory.
const rightView = ref<'image' | 'layer'>('image');

/**
 * The sibling layer's slice of the selected page, as lines. Page breaks are
 * line numbers shared by both layers, so the same case analysis as
 * pageStart/pageEnd applies, resolved against the sibling's own text.
 */
const siblingPage = computed<{ lines: string[]; firstLine: number } | null>(
    () => {
        if (!props.layerCorrespondence) {
            return null;
        }

        const text = props.layerCorrespondence.text;
        let start = 0;
        let end = text.length;
        let firstLine = 0;

        if (selectedPageId.value === null) {
            const first = breaks.value[0];
            end = first ? offsetOfLine(text, first.start_line) : text.length;
        } else if (selectedBreak.value !== null) {
            firstLine = selectedBreak.value.start_line;
            start = offsetOfLine(text, firstLine);
            const next = breaks.value.find(
                (item) => item.start_line > firstLine,
            );
            end = next ? offsetOfLine(text, next.start_line) : text.length;
        }

        return { lines: text.slice(start, end).split('\n'), firstLine };
    },
);

/** The diverging line's index within the sibling page's lines, if visible. */
const siblingDivergentLine = computed(() => {
    const divergence = props.layerCorrespondence?.divergence;

    if (!divergence || !siblingPage.value) {
        return null;
    }

    const index = divergence.line - 1 - siblingPage.value.firstLine;

    return index >= 0 && index < siblingPage.value.lines.length ? index : null;
});

// ---- align to image ----
function armDrawing(granularity: SplitGranularity) {
    if (!activeSelection.value) {
        return;
    }

    splitGranularity.value = granularity;
    // Drawing happens on the leaf, so bring it back if the layer view is up.
    rightView.value = 'image';
    drawingActive.value = true;
}

function onRegionDrawn(box: {
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    if (!activeSelection.value || !selectedImageId.value) {
        return;
    }

    regionError.value = null;

    // Offsets are posted against the saved text — flush pending edits first
    // (the menu already flushed on opening; this covers typing done since).
    void flushText(true).then((ok) => {
        const selection = activeSelection.value;

        if (!ok || !selection || !selectedImageId.value) {
            return;
        }

        postRegion(selection, box);
    });
}

function postRegion(
    selection: ActiveSelection,
    box: { x: number; y: number; width: number; height: number },
) {
    const onFailure = (errors: Record<string, string>) => {
        regionError.value =
            Object.values(errors)[0] ??
            'Could not save that alignment. Try drawing the box again.';
    };

    if (splitGranularity.value === 'span') {
        router.post(
            storeRegion.url(layer.value!.id),
            {
                manuscript_image_id: selectedImageId.value,
                text: selection.text,
                start_offset: selection.start,
                end_offset: selection.end,
                ...box,
            },
            {
                preserveScroll: true,
                onSuccess: () => clearSelection(),
                onError: onFailure,
            },
        );

        return;
    }

    // Draw one guide box over the whole selection; the server divides it
    // into one band per line of the selection and one region per
    // word/character within each, widths following character counts — an
    // approximation to fine-tune afterward, not letter detection.
    router.post(
        storeRegionBatch.url(layer.value!.id),
        {
            manuscript_image_id: selectedImageId.value,
            granularity: splitGranularity.value,
            start_offset: selection.start,
            end_offset: selection.end,
            ...box,
        },
        {
            preserveScroll: true,
            onSuccess: () => clearSelection(),
            onError: onFailure,
        },
    );
}

function performAssignFlow(acknowledgeRealignment: boolean) {
    void flushText(true).then((ok) => {
        if (ok) {
            postAssignment(acknowledgeRealignment);
        }
    });
}

function removeRegion(regionId: number) {
    if (!canEdit.value) {
        return;
    }

    router.delete(destroyRegion.url(regionId), {
        preserveScroll: true,
        onSuccess: () => {
            if (editableRegionId.value === regionId) {
                editableRegionId.value = null;
            }
        },
    });
}

// Delete/Backspace removes the currently-selected image region — but only
// when focus isn't in a text field, so typing a label or editing the text
// doesn't accidentally delete a mapping that happens to be selected.
function onDeleteKeydown(event: KeyboardEvent) {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
    }

    if (editableRegionId.value === null) {
        return;
    }

    const active = document.activeElement;
    const isTyping =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable);

    if (isTyping) {
        return;
    }

    event.preventDefault();
    removeRegion(editableRegionId.value);
}

onMounted(() => document.addEventListener('keydown', onDeleteKeydown));
onUnmounted(() => document.removeEventListener('keydown', onDeleteKeydown));

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
// text (see performAssignFlow above).
function assignSelection(acknowledgeRealignment = false) {
    performAssignFlow(acknowledgeRealignment);
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
</script>

<template>
    <Head
        :title="`${props.witness.siglum} — ${props.witness.label ?? 'witness'}`"
    />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-8 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-7xl">
            <AppHeader />

            <!-- Everything that pertains to the WITNESS lives in this one
                 box, and the word in its border says which editor page this
                 is — the edition page carries the same device. -->
            <fieldset
                class="mt-2 mb-6 inline-block min-w-80 rounded-lg border border-stone-300 px-4 pb-3 text-sm dark:border-stone-700"
            >
                <legend
                    class="px-2 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
                >
                    Witness
                </legend>

                <template v-if="!editingWitness">
                    <h1 class="font-serif text-2xl font-medium">
                        {{ props.witness.siglum }}
                        <template v-if="props.witness.label">
                            &mdash; {{ props.witness.label }}
                        </template>
                        <span
                            v-if="props.witness.date_text"
                            class="text-base font-normal text-stone-500 dark:text-stone-400"
                        >
                            ({{ props.witness.date_text }})
                        </span>
                    </h1>
                    <p
                        v-if="witnessLocation"
                        class="text-stone-600 dark:text-stone-400"
                    >
                        {{ witnessLocation }}
                    </p>
                    <p
                        v-if="showDescription && props.witness.description"
                        class="mt-2 max-w-prose text-stone-600 dark:text-stone-400"
                    >
                        {{ props.witness.description }}
                    </p>

                    <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        <button
                            v-if="props.witness.description"
                            type="button"
                            class="text-stone-500 underline dark:text-stone-400"
                            @click="showDescription = !showDescription"
                        >
                            {{
                                showDescription
                                    ? 'Hide description'
                                    : 'Show description'
                            }}
                        </button>
                        <template v-if="canEdit">
                            <button
                                type="button"
                                class="text-stone-500 underline dark:text-stone-400"
                                @click="editingWitness = true"
                            >
                                Edit witness
                            </button>
                            <button
                                type="button"
                                class="text-stone-500 underline dark:text-stone-400"
                                @click="addTranscription"
                            >
                                + Add transcription
                            </button>
                            <button
                                type="button"
                                class="text-red-600 underline dark:text-red-400"
                                @click="removeWitness"
                            >
                                Delete witness
                            </button>
                        </template>
                    </div>
                </template>

                <form
                    v-else
                    class="flex max-w-md flex-col gap-2 text-xs"
                    @submit.prevent="saveWitness"
                >
                    <label class="flex flex-col gap-0.5">
                        Siglum
                        <input
                            v-model="witnessForm.siglum"
                            type="text"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        />
                    </label>
                    <label class="flex flex-col gap-0.5">
                        Name
                        <input
                            v-model="witnessForm.label"
                            type="text"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        />
                    </label>
                    <label class="flex flex-col gap-0.5">
                        Date
                        <input
                            v-model="witnessForm.date_text"
                            type="text"
                            placeholder="e.g. s. X"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        />
                    </label>
                    <label class="flex flex-col gap-0.5">
                        Repository
                        <input
                            v-model="witnessForm.repository"
                            type="text"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        />
                    </label>
                    <label class="flex flex-col gap-0.5">
                        Shelfmark
                        <input
                            v-model="witnessForm.shelfmark"
                            type="text"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        />
                    </label>
                    <label class="flex flex-col gap-0.5">
                        Description
                        <textarea
                            v-model="witnessForm.description"
                            rows="3"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        ></textarea>
                    </label>
                    <span
                        v-if="witnessForm.errors.siglum"
                        class="text-red-600 dark:text-red-400"
                    >
                        {{ witnessForm.errors.siglum }}
                    </span>
                    <div class="flex items-center gap-2">
                        <button
                            type="submit"
                            class="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                            :disabled="witnessForm.processing"
                        >
                            Save
                        </button>
                        <button
                            type="button"
                            class="text-stone-500 underline dark:text-stone-400"
                            @click="cancelWitnessEdit"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </fieldset>

            <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <div>
                    <!-- The left pane's own header: which transcription is
                         being worked on, and how to start another. It sits
                         here whether or not one is open, so the button does
                         not move once a transcription is chosen. -->
                    <div
                        class="mb-3 flex flex-wrap items-center gap-2 border-b border-stone-200 pb-3 text-xs dark:border-stone-800"
                    >
                        <select
                            v-if="props.transcriptions.length > 1"
                            :value="layer?.transcription_id ?? ''"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            @change="
                                openTranscription(
                                    Number(
                                        ($event.target as HTMLSelectElement)
                                            .value,
                                    ),
                                )
                            "
                        >
                            <option
                                v-for="transcription in props.transcriptions"
                                :key="transcription.id"
                                :value="transcription.id"
                            >
                                {{ transcription.name }}
                            </option>
                        </select>
                        <span
                            v-else-if="layer"
                            class="font-medium text-stone-600 dark:text-stone-400"
                        >
                            {{ layer.transcription?.name }}
                        </span>

                        <button
                            v-if="canEdit && layer"
                            type="button"
                            class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                            @click="importing = !importing"
                        >
                            {{ importing ? 'Cancel' : 'Import a file' }}
                        </button>
                        <button
                            v-if="canEdit && layer"
                            type="button"
                            class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                            @click="openCopyPage"
                        >
                            Copy layer&hellip;
                        </button>

                        <select
                            v-if="canEdit && layer"
                            v-model="visibility"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            @change="saveVisibility"
                        >
                            <option value="published">Published</option>
                            <option value="draft">Draft</option>
                        </select>
                        <span
                            v-else-if="layer"
                            class="text-stone-500 dark:text-stone-400"
                            >{{ layer.transcription?.visibility }}</span
                        >

                        <button
                            v-if="canEdit && layer"
                            type="button"
                            class="text-red-600 underline dark:text-red-400"
                            @click="removeTranscription"
                        >
                            Delete transcription
                        </button>

                        <span
                            v-if="layer"
                            class="ml-auto flex items-center gap-1"
                        >
                            <!-- The two layers must carry the same words in
                                 the same lines (normalization changes only
                                 characters within a word). Divergence is an
                                 editing state to resolve, and this is where
                                 it becomes visible. -->
                            <span
                                v-if="props.layerCorrespondence"
                                class="mr-1"
                                :class="
                                    props.layerCorrespondence.divergence
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-stone-400 dark:text-stone-600'
                                "
                                :title="
                                    props.layerCorrespondence.divergence
                                        ? `This layer has ${props.layerCorrespondence.divergence.a_words ?? 'no'} word(s) on line ${props.layerCorrespondence.divergence.line}, the ${props.layerCorrespondence.sibling} layer ${props.layerCorrespondence.divergence.b_words ?? 'none'} — both layers should carry the same words in the same lines.`
                                        : 'Both layers carry the same words in the same lines.'
                                "
                            >
                                {{
                                    props.layerCorrespondence.divergence
                                        ? `layers differ at line ${props.layerCorrespondence.divergence.line}`
                                        : 'layers in step'
                                }}
                            </span>
                            <button
                                v-for="option in ['diplomatic', 'normalized']"
                                :key="option"
                                type="button"
                                class="rounded border px-2 py-1"
                                :class="
                                    layer.layer === option
                                        ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                        : 'border-stone-300 dark:border-stone-700'
                                "
                                @click="openLayer(option)"
                            >
                                {{ option }}
                            </button>
                        </span>
                    </div>

                    <div
                        v-if="canEdit && importing && layer"
                        class="mb-3 flex flex-wrap items-center gap-2 rounded border border-stone-200 p-2 text-xs dark:border-stone-800"
                    >
                        <span class="text-stone-500 dark:text-stone-400">
                            Insert a plain-text file at the cursor, into the
                            {{ layer.layer }} layer:
                        </span>
                        <input
                            type="file"
                            accept=".txt,text/plain"
                            @change="importFile"
                        />
                        <span class="text-stone-500 dark:text-stone-400">
                            It appears as an unsaved edit, like anything typed.
                        </span>
                        <span
                            v-if="importError"
                            class="w-full text-red-600 dark:text-red-400"
                            >{{ importError }}</span
                        >
                    </div>

                    <!-- Which page is being worked on. The leaf on the right
                         follows this, and so does the text below: a page is
                         the stretch from its own break to the next. Not gated
                         on a layer: while pages and photographs are still
                         being added, before any transcription exists, this
                         row is the only way to move between leaves. -->
                    <div
                        v-if="pages.length > 0"
                        class="mb-3 flex flex-wrap items-center gap-1 text-xs"
                    >
                        <span class="mr-1 text-stone-500 dark:text-stone-400">
                            Page:
                        </span>
                        <button
                            v-if="hasUnplacedOpening"
                            type="button"
                            class="rounded border px-2 py-1"
                            :class="
                                selectedPageId === null
                                    ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                    : 'border-stone-300 dark:border-stone-700'
                            "
                            title="Text standing before the first page begins"
                            @click="selectPage(null)"
                        >
                            before {{ firstPlacedPageLabel }}
                        </button>
                        <button
                            v-for="page in pages"
                            :key="page.id"
                            type="button"
                            class="rounded border px-2 py-1"
                            :class="[
                                selectedPageId === page.id
                                    ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                    : 'border-stone-300 dark:border-stone-700',
                                placedPageIds.includes(page.id)
                                    ? ''
                                    : 'text-stone-400 dark:text-stone-600',
                            ]"
                            :title="
                                placedPageIds.includes(page.id)
                                    ? undefined
                                    : 'No text placed on this page yet'
                            "
                            @click="selectPage(page.id)"
                        >
                            {{ page.label }}
                        </button>
                        <button
                            v-if="canEdit && activeSelection && selectedPage"
                            type="button"
                            class="ml-2 rounded border border-amber-300 px-2 py-1 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                            @click="startPageHere"
                        >
                            {{ selectedPageIsPlaced ? 'Move' : 'Start' }}
                            {{ selectedPage.label }} here
                        </button>
                    </div>

                    <!-- An unplaced page shows the whole text, because placing
                         it is choosing where in the text it begins. -->
                    <p
                        v-if="
                            layer &&
                            canEdit &&
                            selectedPage &&
                            !selectedPageIsPlaced
                        "
                        class="mb-3 text-xs text-amber-700 dark:text-amber-400"
                    >
                        {{ selectedPage.label }} has no text placed on it yet.
                        Select the first words standing on it, then choose
                        &ldquo;Start {{ selectedPage.label }} here&rdquo;. The
                        page runs from there to wherever the next one begins.
                    </p>
                    <p
                        v-if="layer && canEdit && pages.length === 0"
                        class="mb-3 text-xs text-stone-500 dark:text-stone-400"
                    >
                        This manuscript has no pages recorded yet — add one on
                        the right to divide the text onto it.
                    </p>

                    <p
                        v-if="!layer"
                        class="rounded border border-stone-200 p-4 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400"
                    >
                        This witness has no transcription yet.
                        <template v-if="canEdit">
                            Choose &ldquo;Add transcription&rdquo; to start one
                            — both layers are created at once, and you can type
                            into the diplomatic layer or import into the
                            normalized one, whichever suits how you work.
                        </template>
                    </p>

                    <!-- The text is always editable; these act on the current
                         selection when PRESSED, rather than a menu popping up
                         the instant something is selected. mousedown.prevent
                         keeps the click from collapsing that selection. -->
                    <div
                        v-if="canEdit && layer"
                        class="mb-3 flex flex-wrap items-center gap-2 rounded border border-stone-200 p-2 text-xs dark:border-stone-800"
                    >
                        <button
                            type="button"
                            class="rounded border border-stone-300 px-2 py-1 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:text-stone-400"
                            :class="
                                activeMenu === 'assign' &&
                                'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                            "
                            :disabled="!activeSelection"
                            :title="
                                activeSelection
                                    ? undefined
                                    : 'Select a stretch of text first'
                            "
                            @mousedown.prevent
                            @click="openSelectionMenu('assign')"
                        >
                            Assign selection to segment in work
                        </button>
                        <button
                            type="button"
                            class="rounded border border-stone-300 px-2 py-1 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:text-stone-400"
                            :class="
                                activeMenu === 'align' &&
                                'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                            "
                            :disabled="!activeSelection"
                            :title="
                                activeSelection
                                    ? undefined
                                    : 'Select a stretch of text first'
                            "
                            @mousedown.prevent
                            @click="openSelectionMenu('align')"
                        >
                            Map selection to facsimile
                        </button>
                        <span class="mx-1 text-stone-300 dark:text-stone-700"
                            >·</span
                        >
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
                        <span
                            class="ml-auto text-stone-400 dark:text-stone-500"
                        >
                            {{
                                savingText
                                    ? 'Saving…'
                                    : unsavedOps
                                      ? 'Unsaved changes'
                                      : 'All changes saved'
                            }}
                        </span>
                    </div>
                    <p
                        v-else
                        class="mb-3 text-xs text-stone-500 dark:text-stone-400"
                    >
                        Click a citation badge for details.
                    </p>

                    <div
                        v-if="canEdit && layer"
                        class="mb-3 flex flex-col gap-2 rounded border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950"
                    >
                        <span class="text-stone-500 dark:text-stone-400">
                            {{ markupLegend }}
                        </span>

                        <!-- Removing marks only; supplying them is the
                             editor's own work — see lib/greekText.ts. Queued
                             as ordinary pending edits, so they preview live
                             and persist only on Save. -->
                        <span class="flex flex-wrap items-center gap-2">
                            <span class="text-stone-500 dark:text-stone-400"
                                >Strip:</span
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
                                class="rounded border border-stone-300 px-2 py-0.5 dark:border-stone-700"
                                @click="stripMarks(kind)"
                            >
                                {{ kind }}
                            </button>
                        </span>
                        <span
                            v-if="needsDeleteConfirmation"
                            class="flex items-center gap-2 text-red-600 dark:text-red-400"
                        >
                            <label class="flex items-center gap-1">
                                <input
                                    v-model="deleteConfirmed"
                                    type="checkbox"
                                />
                                This will remove
                                <template
                                    v-if="
                                        wouldDeleteAllSegments &&
                                        wouldDeleteAllRegions
                                    "
                                    >every citation and image
                                    alignment</template
                                ><template v-else-if="wouldDeleteAllSegments"
                                    >every citation</template
                                ><template v-else
                                    >every image alignment</template
                                >
                                on this transcription — save anyway
                            </label>
                        </span>
                        <span
                            v-if="textSaveError"
                            class="text-red-600 dark:text-red-400"
                        >
                            {{ textSaveError }}
                        </span>

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
                    <!-- The selection menu lives OUTSIDE the contenteditable
                         element, deliberately: form controls inside an
                         editable region misbehave (Firefox at least), and a
                         native select popup even fires its closing mouseup
                         on the text underneath it — which dismissed the
                         menu mid-use when it rendered inline. Out here its
                         controls are ordinary DOM.

                         It sits ABOVE the text pane, right under the toolbar
                         whose button opens it — placed below the pane it
                         rendered off-screen on a long transcription and
                         looked like it never opened. A flow starting deep in
                         the text (a badge click) scrolls it into view, see
                         the activeMenu watcher. -->
                    <div
                        v-if="activeSelection && activeMenu"
                        ref="selectionMenuEl"
                        class="my-2 flex flex-col gap-2 rounded border border-sky-200 bg-sky-50 p-3 font-sans text-xs dark:border-sky-900 dark:bg-sky-950"
                    >
                        <span class="flex items-center justify-between">
                            <span v-if="matchingSegment"> already marked </span>
                            <span v-else />
                            <button
                                type="button"
                                class="text-stone-500 underline"
                                @click="clearSelection"
                            >
                                Clear
                            </button>
                        </span>

                        <span
                            v-if="overlappingReviewSegment"
                            class="rounded border border-dashed border-red-400 p-2"
                        >
                            <span
                                class="mb-1 block text-red-600 dark:text-red-400"
                            >
                                This overlaps a span flagged for review (its
                                text changed underneath it).
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
                            <span v-if="drawingActive">
                                Drag a box on the image to place
                                <template v-if="splitGranularity === 'span'"
                                    >this text.</template
                                ><template
                                    v-else-if="splitGranularity === 'line'"
                                    >it — one region per line of the selection,
                                    stacked down the box.</template
                                ><template v-else
                                    >it — one region per {{ splitGranularity }},
                                    sized by letter count; each line of the
                                    selection takes its own row of the
                                    box.</template
                                >
                                <button
                                    type="button"
                                    class="ml-1 underline"
                                    @click="drawingActive = false"
                                >
                                    Cancel
                                </button>
                            </span>
                            <span
                                v-else
                                class="flex flex-wrap items-center gap-2"
                            >
                                <button
                                    type="button"
                                    class="self-start text-stone-700 underline disabled:opacity-40 dark:text-stone-300"
                                    :disabled="!selectedImage"
                                    @click="armDrawing('span')"
                                >
                                    as one box
                                </button>
                                <!-- No markup gate: a whole line fills its
                                     band, so a gap can't misplace anything —
                                     line-mapping stays available exactly
                                     where gapped text makes word-splitting
                                     unavailable. -->
                                <button
                                    type="button"
                                    class="self-start text-stone-700 underline disabled:opacity-40 dark:text-stone-300"
                                    :disabled="!selectedImage"
                                    @click="armDrawing('line')"
                                >
                                    split by line
                                </button>
                                <button
                                    type="button"
                                    class="self-start text-stone-700 underline disabled:opacity-40 dark:text-stone-300"
                                    :disabled="
                                        !selectedImage || !selectionIsSplittable
                                    "
                                    :title="
                                        selectionIsSplittable
                                            ? undefined
                                            : 'Contains transcription markup — split a plain-text selection instead'
                                    "
                                    @click="armDrawing('word')"
                                >
                                    split by word
                                </button>
                                <button
                                    type="button"
                                    class="self-start text-stone-700 underline disabled:opacity-40 dark:text-stone-300"
                                    :disabled="
                                        !selectedImage || !selectionIsSplittable
                                    "
                                    :title="
                                        selectionIsSplittable
                                            ? undefined
                                            : 'Contains transcription markup — split a plain-text selection instead'
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
                                Flagged for review — the text here changed since
                                this was mapped.
                            </span>
                            <span
                                v-if="
                                    existingParts.length > 0 &&
                                    !realignmentWarning
                                "
                                class="flex flex-wrap items-center gap-2 text-sky-700 dark:text-sky-400"
                            >
                                <span>
                                    This layer already cites
                                    {{ assignForm.label }} — this span becomes
                                    another part of it, reading
                                </span>
                                <select
                                    v-model="partPlacement"
                                    class="rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                                >
                                    <option :value="null">last</option>
                                    <option :value="0">first</option>
                                    <option
                                        v-for="sibling in existingParts.slice(
                                            0,
                                            -1,
                                        )"
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
                                <span
                                    class="text-amber-700 dark:text-amber-400"
                                >
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
                                    <option value="" disabled>
                                        Work&hellip;
                                    </option>
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
                                <!-- Moving a passage is now plain
                                                 cut & paste: the citation
                                                 travels with the words. -->
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

                    <div class="font-serif text-lg leading-loose">
                        <AlignableText
                            ref="textEl"
                            :text="pageText"
                            :regions="pageRegions"
                            :segments="pageSegments"
                            :part-totals="layerPartTotals"
                            :highlighted-region-id="hoveredRegionId"
                            :editable-region-id="editableRegionId"
                            :editable="canEdit"
                            @select="onTextSelect"
                            @selection-cleared="onSelectionCleared"
                            @hover-region="(id) => (hoveredRegionId = id)"
                            @badge-click="onBadgeClick"
                            @edit="onEdit"
                            @undo="performUndo"
                            @redo="performRedo"
                        />
                    </div>
                </div>

                <div>
                    <!-- What stands beside the text: the manuscript leaf, or
                         (when both layers have text) the other layer's same
                         page — the recovery view when the word-structure
                         indicator says the layers have drifted. -->
                    <div
                        v-if="layerCorrespondence"
                        class="mb-2 flex flex-wrap items-center gap-1 text-xs"
                    >
                        <button
                            type="button"
                            class="rounded border px-2 py-1"
                            :class="
                                rightView === 'image'
                                    ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                    : 'border-stone-300 dark:border-stone-700'
                            "
                            @click="rightView = 'image'"
                        >
                            Manuscript
                        </button>
                        <button
                            type="button"
                            class="rounded border px-2 py-1"
                            :class="
                                rightView === 'layer'
                                    ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                    : 'border-stone-300 dark:border-stone-700'
                            "
                            @click="rightView = 'layer'"
                        >
                            {{ layerCorrespondence.sibling }} layer
                        </button>
                    </div>

                    <div
                        v-if="rightView === 'layer' && siblingPage"
                        class="max-h-[36rem] overflow-y-auto rounded-lg border border-stone-300 p-3 font-serif text-lg leading-loose dark:border-stone-700"
                    >
                        <div
                            v-for="(line, index) in siblingPage.lines"
                            :key="index"
                            class="min-h-[1.75em] whitespace-pre-wrap"
                            :class="
                                index === siblingDivergentLine &&
                                'rounded bg-amber-100 dark:bg-amber-950'
                            "
                        >
                            {{ line }}
                        </div>
                    </div>

                    <template v-else>
                        <p
                            v-if="editableRegionId"
                            class="mb-2 flex items-center justify-between text-xs text-sky-700 dark:text-sky-400"
                        >
                            <span
                                >Drag the box's body to move it, or a handle to
                                resize.</span
                            >
                            <span class="flex items-center gap-2">
                                <button
                                    type="button"
                                    class="text-red-600 underline dark:text-red-400"
                                    @click="removeRegion(editableRegionId!)"
                                >
                                    Delete
                                </button>
                                <button
                                    type="button"
                                    class="underline"
                                    @click="editableRegionId = null"
                                >
                                    Done
                                </button>
                            </span>
                        </p>
                        <ManuscriptImageViewer
                            :image="selectedImage"
                            :regions="regionsForSelectedImage"
                            :features="featuresForSelectedImage"
                            :highlighted-region-id="hoveredRegionId"
                            :editable-region-id="editableRegionId"
                            :drawing-enabled="drawingActive"
                            @region-drawn="onRegionDrawn"
                            @region-moved="onRegionMoved"
                            @select-region="selectRegionForEditing"
                            @deselect="editableRegionId = null"
                            @hover-region="(id) => (hoveredRegionId = id)"
                        >
                            <!-- Plenty of pages are transcribed from a facsimile
                             or the manuscript itself, so having no photograph
                             is ordinary rather than an omission. -->
                            <template #empty>
                                <span v-if="selectedPage">
                                    No photograph of
                                    {{ selectedPage.label }} yet.
                                </span>
                                <span v-else-if="pages.length === 0">
                                    No pages recorded for this manuscript yet.
                                </span>
                                <span v-else>Choose a page.</span>
                            </template>
                        </ManuscriptImageViewer>
                        <div
                            v-if="imagesForSelectedPage.length > 1"
                            class="mt-3 flex flex-wrap gap-2"
                        >
                            <!-- Photographs of *this* page only. Which leaf is
                             shown follows the page chosen on the left, so
                             offering another page's here would break the pair.
                             A page can have more than one shot of it. -->
                            <button
                                v-for="image in imagesForSelectedPage"
                                :key="image.id"
                                type="button"
                                class="rounded border px-2 py-1 text-xs"
                                :class="
                                    image.id === selectedImageId
                                        ? 'border-stone-500 bg-stone-100 dark:bg-stone-800'
                                        : 'border-stone-200 dark:border-stone-800'
                                "
                                @click="selectedImageId = image.id"
                            >
                                fol. {{ image.manuscript_page?.label }}
                            </button>
                        </div>

                        <!-- Pages can be recorded with no photograph at all: a
                         manuscript is often transcribed from a facsimile, and
                         its text still has to be divided onto its leaves.
                         Uploading a photograph names a page too, and records
                         it if it is new. -->
                        <form
                            v-if="canEdit"
                            class="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3 dark:border-stone-800"
                            @submit.prevent="addPage"
                        >
                            <input
                                v-model="newPageLabel"
                                type="text"
                                placeholder="page (e.g. 13r)"
                                class="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-700"
                            />
                            <button
                                type="submit"
                                class="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-stone-700"
                                :disabled="!newPageLabel.trim()"
                            >
                                Add page
                            </button>
                            <span
                                class="text-xs text-stone-500 dark:text-stone-400"
                            >
                                no image needed
                            </span>
                            <button
                                v-if="selectedPage"
                                type="button"
                                class="ml-auto text-xs text-red-600 underline dark:text-red-400"
                                @click="deleteSelectedPage"
                            >
                                Delete {{ selectedPage.label }}
                            </button>
                        </form>

                        <form
                            v-if="canEdit"
                            class="mt-3 flex flex-wrap items-center gap-2"
                            @submit.prevent="uploadImage"
                        >
                            <input
                                v-model="imageUploadForm.folio_label"
                                type="text"
                                placeholder="folio (e.g. 12r)"
                                class="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-700"
                            />
                            <input
                                type="file"
                                accept="image/*"
                                class="text-xs"
                                @change="onImageFileChange"
                            />
                            <button
                                type="submit"
                                class="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-stone-700"
                                :disabled="
                                    imageUploadForm.processing ||
                                    !imageUploadForm.folio_label ||
                                    !imageUploadForm.image
                                "
                            >
                                Upload page
                            </button>
                            <span
                                v-if="imageUploadForm.errors.image"
                                class="text-xs text-red-600 dark:text-red-400"
                            >
                                {{ imageUploadForm.errors.image }}
                            </span>
                        </form>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>
