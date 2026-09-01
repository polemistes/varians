<script setup lang="ts">
import { Head, Link, router, useForm, usePage } from '@inertiajs/vue3';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AlignableText from '@/components/AlignableText.vue';
import AppHeader from '@/components/AppHeader.vue';
import ManuscriptImageViewer from '@/components/ManuscriptImageViewer.vue';
import { isEditorOrAbove } from '@/lib/auth';
import {
    confirmDeletion,
    describeDeletionImpact,
    pluralize,
} from '@/lib/deletionImpact';
import { stripOps } from '@/lib/greekText';
import type { StripKind } from '@/lib/greekText';
import { applyOps, transformSpans } from '@/lib/transcriptionEdit';
import type { TextEditOp } from '@/lib/transcriptionEdit';
import { store as storeImage } from '@/routes/manuscript-images';
import { store as storeManuscriptPage } from '@/routes/manuscript-pages';
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
import { update as updateTranscriptionText } from '@/routes/transcriptions/text';
import {
    index as witnessesIndex,
    show as showWitnessRoute,
} from '@/routes/witnesses';
import { destroy as destroyWitness } from '@/routes/witnesses';
import { store as storeTranscriptionRoute } from '@/routes/witnesses/transcriptions';
import { show as showWork } from '@/routes/works';
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
    works: Work[];
    existingTags: string[];
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

const manuscriptSummary = computed(() => {
    const manuscript = props.witness.manuscript;

    if (!manuscript) {
        return null;
    }

    const location = [manuscript.repository, manuscript.shelfmark]
        .filter(Boolean)
        .join(', ');
    const date = manuscript.date_text ? `(${manuscript.date_text})` : '';

    return [location, date].filter(Boolean).join(' ') || null;
});

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

// ---- tags ----
const tagsForm = useForm({
    tags: (props.transcription?.tags ?? []).map((tag) => tag.name),
});
const newTagInput = ref('');

function addTag(name?: string) {
    const value = (name ?? newTagInput.value).trim();

    if (!value || tagsForm.tags.includes(value)) {
        return;
    }

    tagsForm.tags.push(value);
    newTagInput.value = '';
}

function removeTag(name: string) {
    tagsForm.tags = tagsForm.tags.filter((tag) => tag !== name);
}

function saveTags() {
    if (!layer.value) {
        return;
    }

    tagsForm.patch(updateTranscription.url(layer.value), {
        preserveScroll: true,
    });
}

function cancelTags() {
    tagsForm.reset();
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
// SpanTransformer/TextOpApplier) for instant visual feedback, then submitted
// as one batch on Save — see TranscriptionTextController for the
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

    return spans.flatMap((span, index) => {
        const result = transformed[index];

        if (result.deleted) {
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

const wouldDeleteAllSegments = computed(
    () => layerSegments.value.length > 0 && editedSegments.value.length === 0,
);
const wouldDeleteAllRegions = computed(
    () => layerRegions.value.length > 0 && editedRegions.value.length === 0,
);
const needsDeleteConfirmation = computed(
    () => wouldDeleteAllSegments.value || wouldDeleteAllRegions.value,
);
const deleteConfirmed = ref(false);
const canSaveText = computed(
    () =>
        editOps.value.length > 0 &&
        (!needsDeleteConfirmation.value || deleteConfirmed.value),
);

const savingText = ref(false);
const textSaveError = ref<string | null>(null);

// Set by the server when a saved edit also changed an edition's own printed
// wording — the one consequence an editor cannot see from this page. Not an
// error and nothing to confirm; see TranscriptionTextController::applyReadings.
const textSaveNotice = computed(() => page.props.flash?.message ?? null);

function onEdit(op: TextEditOp) {
    // Typed inside the page, recorded against the whole text — that is what
    // the server replays and what every other offset is measured in.
    editOps.value = [
        ...editOps.value,
        { start: toFull(op.start), end: toFull(op.end), text: op.text },
    ];
    deleteConfirmed.value = false;
    textSaveError.value = null;
}

/**
 * Queue the edits that strip a class of marks from the whole text.
 *
 * Goes through the same pending-ops mechanism as typing, rather than
 * replacing the text outright: every citation span, image region and collated
 * reading is recorded as offsets into this text, and a wholesale replacement
 * would read as "all of it changed" and flag or destroy them. The result is
 * previewed like any other edit and only persists on Save.
 */
function stripMarks(kind: StripKind) {
    const ops = stripOps(editedText.value, kind);

    if (ops.length === 0) {
        return;
    }

    editOps.value = [...editOps.value, ...ops];
    deleteConfirmed.value = false;
    textSaveError.value = null;
}

function discardTextEdits() {
    editOps.value = [];
    deleteConfirmed.value = false;
    textSaveError.value = null;
}

function saveText() {
    if (!canSaveText.value) {
        return;
    }

    savingText.value = true;

    router.patch(
        updateTranscriptionText.url(layer.value!),
        { ops: editOps.value, text: editedText.value },
        {
            preserveScroll: true,
            onSuccess: () => discardTextEdits(),
            onError: (errors) => {
                textSaveError.value =
                    Object.values(errors)[0] ?? 'Could not save these changes.';
            },
            onFinish: () => {
                savingText.value = false;
            },
        },
    );
}

// ---- manuscript images ----
const manuscript = computed(() => props.witness.manuscript ?? null);
const images = computed(() => manuscript.value?.images ?? []);

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
    if (!manuscript.value) {
        return;
    }

    imageUploadForm.post(storeImage.url(manuscript.value.id), {
        preserveScroll: true,
        onSuccess: () => imageUploadForm.reset(),
    });
}

// ---- selection: the single surface for "align to image", "assign
// citation", and now "edit text" — a scholar selects (or, in edit mode,
// directly edits) a span of the running text, and picks whichever mapping
// applies, without switching to a different text box.
// `interactionMode` is the persistent, always-visible choice of what a fresh
// selection is for; `activeMenu` is which contextual menu is actually shown
// for the *current* selection — normally the same as interactionMode, but
// clicking an existing citation badge always means "assign", regardless of
// what the toolbar is currently set to.
type InteractionMode = 'align' | 'assign' | 'edit';
const interactionMode = ref<InteractionMode>(
    layerText.value === '' ? 'edit' : 'assign',
);
const activeMenu = ref<InteractionMode | null>(null);

// The text/segments/regions actually rendered: live-edited local state while
// in edit mode (so highlighted spans visibly move as the scholar types),
// otherwise exactly what's persisted.
const activeText = computed(() =>
    interactionMode.value === 'edit' ? editedText.value : layerText.value,
);
const activeSegments = computed(() =>
    interactionMode.value === 'edit'
        ? editedSegments.value
        : layerSegments.value,
);
const activeRegions = computed(() =>
    interactionMode.value === 'edit' ? editedRegions.value : layerRegions.value,
);

// ---- pages ----
// The left pane shows only the text standing on the page being worked on, so
// that it reads beside the leaf on the right rather than as one long scroll.
//
// A page runs from its own break to the next one — see TranscriptionPageBreak
// — and text before the first break belongs to no page yet. Everything else in
// this component works in whole-text offsets, so the slice is converted at
// exactly two places inbound (a selection, an edit) and at the props handed to
// AlignableText outbound. `toFull` and `toPage` are the only conversions.
const pages = computed(() => manuscript.value?.pages ?? []);

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

    if (
        editOps.value.length > 0 &&
        !window.confirm('Discard your unsaved text edits?')
    ) {
        return;
    }

    router.get(
        showWitnessRoute.url(props.witness),
        { transcription: layer.value.transcription_id, layer: name },
        { preserveScroll: true },
    );
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

    router.post(
        storePageBreak.url(layer.value),
        {
            manuscript_page_id: selectedPageId.value,
            start_offset: activeSelection.value.start,
        },
        { preserveScroll: true, onSuccess: () => clearSelection() },
    );
}

const newPageLabel = ref('');

function addPage() {
    if (!manuscript.value || !newPageLabel.value.trim()) {
        return;
    }

    router.post(
        storeManuscriptPage.url(manuscript.value.id),
        { label: newPageLabel.value.trim() },
        { preserveScroll: true, onSuccess: () => (newPageLabel.value = '') },
    );
}

function selectPage(id: number | null) {
    selectedPageId.value = id;
    clearSelection();
}

type ActiveSelection = { start: number; end: number; text: string };
const activeSelection = ref<ActiveSelection | null>(null);
const drawingActive = ref(false);
const regionError = ref<string | null>(null);
const assignError = ref<string | null>(null);

const assignForm = useForm({ work_id: '' as number | '', label: '' });

// Remembered across selections within this editing session (not persisted)
// so a scholar marking up a run of consecutive lines doesn't have to re-pick
// the work and retype the next line number each time.
const lastWorkId = ref<number | ''>('');
const lastLabel = ref('');

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

function setInteractionMode(mode: InteractionMode) {
    if (
        interactionMode.value === 'edit' &&
        mode !== 'edit' &&
        editOps.value.length > 0 &&
        !window.confirm('Discard your unsaved text edits?')
    ) {
        return;
    }

    if (interactionMode.value === 'edit' && mode !== 'edit') {
        discardTextEdits();
    }

    interactionMode.value = mode;
    clearSelection();
}

// A selection carrying transcription markup can't be batch-split — a gap
// has no ink to align, and mixing "real" and "guessed" text into one
// uniform division would misplace every unit after it.
const selectionIsSplittable = computed(
    () =>
        !!activeSelection.value && !/[[\]{}_]/.test(activeSelection.value.text),
);
type SplitGranularity = 'span' | 'word' | 'character';
const splitGranularity = ref<SplitGranularity>('span');

const matchingSegment = computed<TranscriptionSegment | null>(() => {
    if (!activeSelection.value) {
        return null;
    }

    return (
        layerSegments.value.find(
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
        layerSegments.value.find(
            (segment) =>
                segment.needs_review &&
                segment.start_offset < activeSelection.value!.end &&
                segment.end_offset > activeSelection.value!.start,
        ) ?? null
    );
});

// Shared by a fresh drag-selection and a badge click — both land on a span
// of text and need the same "is this already marked, what should the
// assign form default to" setup, just with a different resulting menu.
function selectRange(start: number, end: number, text: string) {
    activeSelection.value = { start, end, text };
    drawingActive.value = false;
    regionError.value = null;
    assignError.value = null;

    const existing = layerSegments.value.find(
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

    selectRange(toFull(selection.start), toFull(selection.end), selection.text);
    activeMenu.value = interactionMode.value;
}

function onBadgeClick(segment: TranscriptionSegment) {
    if (!canEdit.value) {
        return;
    }

    if (matchingSegment.value?.id === segment.id) {
        clearSelection();

        return;
    }

    // The badge came from the page-scoped segments handed to AlignableText,
    // so its offsets are the page's.
    const start = toFull(segment.start_offset);
    const end = toFull(segment.end_offset);

    selectRange(start, end, layerText.value.slice(start, end));
    activeMenu.value = 'assign';
}

function clearSelection() {
    activeSelection.value = null;
    activeMenu.value = null;
    drawingActive.value = false;
    splitGranularity.value = 'span';
}

// ---- align to image ----
function armDrawing(granularity: SplitGranularity) {
    if (!activeSelection.value) {
        return;
    }

    splitGranularity.value = granularity;
    drawingActive.value = true;
}

function onRegionDrawn(box: {
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    const selection = activeSelection.value;

    if (!selection || !selectedImageId.value) {
        return;
    }

    regionError.value = null;

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
    // into one evenly-spaced region per word/character, skipping spaces —
    // a uniform approximation to fine-tune afterward, not letter detection.
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
// A span is always marked and cited in the same action — a span with no
// citation would have no use to anyone, so there's no "assign later" step.
function assignSelection() {
    if (!activeSelection.value || !assignForm.work_id || !assignForm.label) {
        return;
    }

    assignError.value = null;

    const workId = assignForm.work_id;
    const label = assignForm.label;
    const rememberChoice = () => {
        lastWorkId.value = workId;
        lastLabel.value = label;
    };

    if (matchingSegment.value) {
        router.patch(
            assignCitationRoute.url(matchingSegment.value.id),
            { work_id: workId, label },
            {
                preserveScroll: true,
                onSuccess: () => {
                    rememberChoice();
                    clearSelection();
                },
                onError: (errors) => {
                    assignError.value =
                        Object.values(errors)[0] ??
                        'Could not assign that citation.';
                },
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
        },
        {
            preserveScroll: true,
            onSuccess: () => {
                rememberChoice();
                clearSelection();
            },
            onError: (errors) => {
                assignError.value =
                    Object.values(errors)[0] ?? 'Could not mark that span.';
            },
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

    router.patch(
        updateSegment.url(overlappingReviewSegment.value.id),
        {
            start_offset: activeSelection.value.start,
            end_offset: activeSelection.value.end,
        },
        { preserveScroll: true, onSuccess: () => clearSelection() },
    );
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

            <Link
                :href="witnessesIndex.url()"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; Witnesses
            </Link>

            <div class="mt-2 mb-1 flex items-baseline gap-3">
                <h1 class="font-serif text-2xl font-medium">
                    {{ props.witness.siglum }}
                    <template v-if="props.witness.label">
                        &mdash; {{ props.witness.label }}
                    </template>
                </h1>
                <span class="text-xs text-stone-500 dark:text-stone-400">{{
                    props.witness.type
                }}</span>
            </div>

            <div
                class="mb-6 flex flex-wrap items-center justify-between gap-4 text-sm"
            >
                <p class="text-stone-600 dark:text-stone-400">
                    <span v-if="manuscriptSummary">{{
                        manuscriptSummary
                    }}</span>
                    <span
                        v-for="work in props.witness.works ?? []"
                        :key="work.id"
                        class="ml-2"
                    >
                        <Link
                            :href="showWork.url(work)"
                            class="underline underline-offset-2"
                            >{{ work.title }}</Link
                        >
                    </span>
                </p>
                <button
                    v-if="canEdit"
                    type="button"
                    class="text-xs text-red-600 underline dark:text-red-400"
                    @click="removeWitness"
                >
                    Delete witness
                </button>
            </div>

            <div v-if="canEdit" class="mb-4">
                <button
                    type="button"
                    class="text-xs text-red-600 underline dark:text-red-400"
                    @click="removeTranscription"
                >
                    Delete transcription
                </button>
            </div>

            <div v-if="canEdit" class="mb-6 flex flex-wrap items-center gap-2">
                <span
                    v-for="tag in tagsForm.tags"
                    :key="tag"
                    class="flex items-center gap-1 rounded-full bg-stone-200 px-2.5 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                >
                    {{ tag }}
                    <button
                        type="button"
                        class="text-stone-500 hover:text-red-600 dark:text-stone-400"
                        @click="removeTag(tag)"
                    >
                        ×
                    </button>
                </span>
                <input
                    v-model="newTagInput"
                    type="text"
                    list="existing-tags"
                    placeholder="+ tag"
                    class="w-28 rounded border border-dashed border-stone-300 bg-transparent px-2 py-0.5 text-xs dark:border-stone-700"
                    @keydown.enter.prevent="addTag()"
                />
                <datalist id="existing-tags">
                    <option
                        v-for="tag in existingTags"
                        :key="tag"
                        :value="tag"
                    />
                </datalist>
                <button
                    v-if="tagsForm.isDirty"
                    type="button"
                    class="rounded bg-stone-900 px-2 py-0.5 text-xs text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="tagsForm.processing"
                    @click="saveTags"
                >
                    Save
                </button>
                <button
                    v-if="tagsForm.isDirty"
                    type="button"
                    class="text-xs text-stone-500 underline dark:text-stone-400"
                    @click="cancelTags"
                >
                    Cancel
                </button>
            </div>
            <div v-else class="mb-6 flex flex-wrap items-center gap-2">
                <span
                    v-for="tag in tagsForm.tags"
                    :key="tag"
                    class="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                >
                    {{ tag }}
                </span>
            </div>

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
                            v-if="canEdit"
                            type="button"
                            class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                            @click="addTranscription"
                        >
                            + Add transcription
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

                        <span
                            v-if="layer"
                            class="ml-auto flex items-center gap-1"
                        >
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

                    <!-- Which page is being worked on. The leaf on the right
                         follows this, and so does the text below: a page is
                         the stretch from its own break to the next. -->
                    <div
                        v-if="layer && pages.length > 0"
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

                    <div
                        v-if="canEdit && layer"
                        class="mb-3 flex flex-wrap items-center gap-2 rounded border border-stone-200 p-2 text-xs dark:border-stone-800"
                    >
                        <span class="text-stone-500 dark:text-stone-400">
                            Mode:
                        </span>
                        <button
                            type="button"
                            class="rounded px-2 py-1"
                            :class="
                                interactionMode === 'edit'
                                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                                    : 'border border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-400'
                            "
                            @click="setInteractionMode('edit')"
                        >
                            Edit text
                        </button>
                        <button
                            type="button"
                            class="rounded px-2 py-1"
                            :class="
                                interactionMode === 'align'
                                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                                    : 'border border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-400'
                            "
                            @click="setInteractionMode('align')"
                        >
                            Map selection to facsimile
                        </button>
                        <button
                            type="button"
                            class="rounded px-2 py-1"
                            :class="
                                interactionMode === 'assign'
                                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                                    : 'border border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-400'
                            "
                            @click="setInteractionMode('assign')"
                        >
                            Assign selection to segment in work
                        </button>
                    </div>
                    <p
                        v-else
                        class="mb-3 text-xs text-stone-500 dark:text-stone-400"
                    >
                        Click a citation badge for details.
                    </p>

                    <div
                        v-if="interactionMode === 'edit'"
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
                            v-if="textSaveNotice"
                            class="rounded border border-sky-300 bg-white px-2 py-1 text-sky-800 dark:border-sky-800 dark:bg-stone-900 dark:text-sky-300"
                        >
                            {{ textSaveNotice }}
                        </span>

                        <span class="flex items-center gap-2">
                            <button
                                type="button"
                                class="rounded bg-stone-900 px-2 py-0.5 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                :disabled="!canSaveText || savingText"
                                @click="saveText()"
                            >
                                {{ savingText ? 'Saving…' : 'Save' }}
                            </button>
                            <button
                                v-if="editOps.length > 0"
                                type="button"
                                class="text-stone-500 underline"
                                @click="discardTextEdits"
                            >
                                Cancel
                            </button>
                        </span>
                    </div>

                    <div class="font-serif text-lg leading-loose">
                        <AlignableText
                            :text="pageText"
                            :regions="pageRegions"
                            :segments="pageSegments"
                            :highlighted-region-id="hoveredRegionId"
                            :editable-region-id="editableRegionId"
                            :selection-start="
                                activeSelection
                                    ? toPage(activeSelection.start)
                                    : null
                            "
                            :selection-end="
                                activeSelection
                                    ? toPage(activeSelection.end)
                                    : null
                            "
                            :editable="interactionMode === 'edit'"
                            @select="onTextSelect"
                            @hover-region="(id) => (hoveredRegionId = id)"
                            @badge-click="onBadgeClick"
                            @edit="onEdit"
                        >
                            <template v-if="activeSelection" #selection-menu>
                                <span
                                    class="my-2 flex flex-col gap-2 rounded border border-sky-200 bg-sky-50 p-3 font-sans text-xs dark:border-sky-900 dark:bg-sky-950"
                                >
                                    <span
                                        class="flex items-center justify-between"
                                    >
                                        <span v-if="matchingSegment">
                                            already marked
                                        </span>
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
                                            This overlaps a span flagged for
                                            review (its text changed underneath
                                            it).
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
                                            <template
                                                v-if="
                                                    splitGranularity === 'span'
                                                "
                                                >this text.</template
                                            ><template v-else
                                                >it — one region will be created
                                                per {{ splitGranularity }},
                                                evenly spaced along the
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
                                            <button
                                                type="button"
                                                class="self-start text-stone-700 underline disabled:opacity-40 dark:text-stone-300"
                                                :disabled="
                                                    !selectedImage ||
                                                    !selectionIsSplittable
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
                                                    !selectedImage ||
                                                    !selectionIsSplittable
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

                                    <template
                                        v-else-if="activeMenu === 'assign'"
                                    >
                                        <span
                                            v-if="matchingSegment?.needs_review"
                                            class="text-red-600 dark:text-red-400"
                                        >
                                            Flagged for review — the text here
                                            changed since this was mapped.
                                        </span>
                                        <span
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
                                                @click="assignSelection"
                                            >
                                                {{
                                                    matchingSegment
                                                        ? 'Update citation'
                                                        : 'Mark & assign'
                                                }}
                                            </button>
                                            <button
                                                v-if="matchingSegment"
                                                type="button"
                                                class="text-red-600 underline dark:text-red-400"
                                                @click="
                                                    removeSegment(
                                                        matchingSegment.id,
                                                    )
                                                "
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
                                </span>
                            </template>
                        </AlignableText>
                    </div>
                </div>

                <div>
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
                                No photograph of {{ selectedPage.label }} yet.
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
                        v-if="manuscript && canEdit"
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
                    </form>

                    <form
                        v-if="manuscript && canEdit"
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
                </div>
            </div>
        </div>
    </div>
</template>
