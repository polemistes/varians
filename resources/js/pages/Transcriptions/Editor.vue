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
import { applyOps, transformSpans } from '@/lib/transcriptionEdit';
import type { TextEditOp } from '@/lib/transcriptionEdit';
import { store as storeImage } from '@/routes/manuscript-images';
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
import { show as showWitness } from '@/routes/witnesses';
import type { Auth } from '@/types/auth';
import type {
    Transcription,
    TranscriptionRegion,
    TranscriptionSegment,
    Work,
} from '@/types/models';

const props = defineProps<{
    transcription: Transcription;
    works: Work[];
    existingTags: string[];
}>();

const page = usePage<{
    auth: Auth;
    flash?: { message?: string | null };
}>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

const markupLegend =
    '[abc] restored · [3] / [?] lost, extent known/unknown · ' +
    '{3} / {?} illegible, extent known/unknown · _abc_ uncertain reading';

function removeTranscription() {
    const parts = describeDeletionImpact(props.transcription.deletion_impact, [
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

    router.delete(destroyTranscription.url(props.transcription));
}

// ---- tags ----
const tagsForm = useForm({
    tags: (props.transcription.tags ?? []).map((tag) => tag.name),
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
    tagsForm.patch(updateTranscription.url(props.transcription), {
        preserveScroll: true,
    });
}

function cancelTags() {
    tagsForm.reset();
}

// A plain ref (not a separate useForm) so this always PATCHes the *current*
// visibility — a useForm's initial state is captured once at setup and would
// go stale if it captured props.transcription.visibility instead.
const visibility = ref(props.transcription.visibility);

function saveVisibility() {
    router.patch(
        updateTranscription.url(props.transcription),
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

const editedText = computed(() =>
    applyOps(props.transcription.text, editOps.value),
);

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
    transformedSpans(props.transcription.segments ?? []),
);

const editedRegions = computed<TranscriptionRegion[]>(() =>
    transformedSpans(props.transcription.regions ?? []).map((region) => ({
        ...region,
        text: editedText.value.slice(region.start_offset, region.end_offset),
    })),
);

const wouldDeleteAllSegments = computed(
    () =>
        (props.transcription.segments?.length ?? 0) > 0 &&
        editedSegments.value.length === 0,
);
const wouldDeleteAllRegions = computed(
    () =>
        (props.transcription.regions?.length ?? 0) > 0 &&
        editedRegions.value.length === 0,
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
    editOps.value = [...editOps.value, op];
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
        updateTranscriptionText.url(props.transcription),
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
const manuscript = computed(
    () => props.transcription.witness?.manuscript ?? null,
);
const images = computed(() => manuscript.value?.images ?? []);
const selectedImageId = ref<number | null>(images.value[0]?.id ?? null);

// Freshly uploaded images arrive via a normal prop reload, but a plain ref
// set once at setup time wouldn't notice — without this, a first upload
// (going from no images to one) stayed invisible until a manual reload.
watch(images, (current) => {
    if (selectedImageId.value === null && current.length > 0) {
        selectedImageId.value = current[0].id;
    }
});

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
    props.transcription.text === '' ? 'edit' : 'assign',
);
const activeMenu = ref<InteractionMode | null>(null);

// The text/segments/regions actually rendered: live-edited local state while
// in edit mode (so highlighted spans visibly move as the scholar types),
// otherwise exactly what's persisted.
const activeText = computed(() =>
    interactionMode.value === 'edit'
        ? editedText.value
        : props.transcription.text,
);
const activeSegments = computed(() =>
    interactionMode.value === 'edit'
        ? editedSegments.value
        : (props.transcription.segments ?? []),
);
const activeRegions = computed(() =>
    interactionMode.value === 'edit'
        ? editedRegions.value
        : (props.transcription.regions ?? []),
);

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
        (props.transcription.segments ?? []).find(
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
        (props.transcription.segments ?? []).find(
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

    const existing = (props.transcription.segments ?? []).find(
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

    selectRange(selection.start, selection.end, selection.text);
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

    selectRange(
        segment.start_offset,
        segment.end_offset,
        props.transcription.text.slice(
            segment.start_offset,
            segment.end_offset,
        ),
    );
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
            storeRegion.url(props.transcription.id),
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
        storeRegionBatch.url(props.transcription.id),
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
        storeSegment.url(props.transcription.id),
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
    <Head :title="`${props.transcription.witness?.siglum} transcription`" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-8 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-6xl">
            <AppHeader />

            <Link
                :href="showWitness.url(props.transcription.witness_id)"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; {{ props.transcription.witness?.siglum }}
            </Link>

            <div class="mt-2 mb-4 flex items-baseline justify-between gap-4">
                <h1 class="font-serif text-2xl font-medium">
                    {{ props.transcription.witness?.siglum }} transcription
                </h1>
                <select
                    v-if="canEdit"
                    v-model="visibility"
                    class="rounded border border-stone-300 bg-transparent px-2 py-0.5 text-xs dark:border-stone-700"
                    @change="saveVisibility"
                >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                </select>
                <span
                    v-else
                    class="text-xs text-stone-500 dark:text-stone-400"
                    >{{ props.transcription.visibility }}</span
                >
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
                    />
                    <div
                        v-if="images.length > 1"
                        class="mt-3 flex flex-wrap gap-2"
                    >
                        <button
                            v-for="image in images"
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
                            fol. {{ image.folio_label }}
                        </button>
                    </div>

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

                <div>
                    <div
                        v-if="canEdit"
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
                            :text="activeText"
                            :regions="activeRegions"
                            :segments="activeSegments"
                            :highlighted-region-id="hoveredRegionId"
                            :editable-region-id="editableRegionId"
                            :selection-start="activeSelection?.start ?? null"
                            :selection-end="activeSelection?.end ?? null"
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
            </div>
        </div>
    </div>
</template>
