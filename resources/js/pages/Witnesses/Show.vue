<script lang="ts">
// Which tab each pane shows, per witness — module scope, so it survives
// the page component being recreated by a full post-reload (a ref alone
// reset to server truth then, flipping a facsimile tab back to transcript
// after every save; real bug, twice).
const paneTabMemory = new Map<
    number,
    { left: 'transcript' | 'facsimile'; right: 'transcript' | 'facsimile' }
>();
</script>

<script setup lang="ts">
import { Head, router, useForm, usePage } from '@inertiajs/vue3';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import FacsimilePane from '@/components/FacsimilePane.vue';
import TranscriptPane from '@/components/TranscriptPane.vue';
import type { PanePayload } from '@/components/TranscriptPane.vue';
import { isEditorOrAbove } from '@/lib/auth';
import {
    confirmDeletion,
    describeDeletionImpact,
    pluralize,
} from '@/lib/deletionImpact';
import {
    destroy as destroyManuscriptPage,
    store as storeManuscriptPage,
    update as updateManuscriptPage,
} from '@/routes/manuscript-pages';
import { destroy as destroyRegion } from '@/routes/transcription-regions';
import { store as storeSpanCopy } from '@/routes/transcriptions/span-copies';
import {
    show as showWitnessRoute,
    update as updateWitness,
} from '@/routes/witnesses';
import { destroy as destroyWitness } from '@/routes/witnesses';
import { store as storeTranscriptRoute } from '@/routes/witnesses/transcriptions';
import type { Auth } from '@/types/auth';
import type {
    ManuscriptPage,
    Transcription,
    Witness,
    Work,
} from '@/types/models';

const props = defineProps<{
    witness: Witness;
    /** Every transcript of this witness, layers included, for the pickers. */
    transcripts: Transcription[];
    leftPane: PanePayload;
    rightPane: PanePayload;
    works: Work[];
    /** Every visible witness, for the change-witness picker in the box. */
    witnessOptions: Pick<Witness, 'id' | 'siglum' | 'label'>[];
}>();

const page = usePage<{ auth: Auth; flash?: { message?: string | null } }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

// ---- the witness box ----
function removeWitness() {
    const parts = describeDeletionImpact(props.witness.deletion_impact, [
        {
            key: 'transcriptions',
            label: (n) => pluralize(n, 'transcript'),
        },
        { key: 'segments', label: (n) => pluralize(n, 'assignment') },
        { key: 'regions', label: (n) => pluralize(n, 'image mapping') },
        { key: 'images', label: (n) => pluralize(n, 'facsimile image') },
        { key: 'pages', label: (n) => pluralize(n, 'page') },
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

function openWitness(id: number) {
    if (id !== props.witness.id) {
        router.get(showWitnessRoute.url(id));
    }
}

function addTranscript() {
    const name = window.prompt(
        'What is this a transcript of? (e.g. "Main text", "Scholia")',
        'Transcript',
    );

    if (name === null) {
        return;
    }

    router.post(storeTranscriptRoute.url(props.witness), {
        name: name.trim() || 'Transcript',
    });
}

// ---- the two panes ----
// Left and right are places to put things: each shows either a transcript
// layer (a full editor) or the facsimile, chosen by its tabs. Which LAYERS
// are open lives in the URL (the server loads them); showing the facsimile
// is purely client-side, since all its data is already on the page.
type Side = 'left' | 'right';
type PaneTab = 'transcript' | 'facsimile';

// Which tab each pane shows is CLIENT state (a facsimile tab needs no
// server data) — see paneTabMemory above for why it lives at module scope.
const display = ref<Record<Side, PaneTab>>(
    paneTabMemory.get(props.witness.id) ?? {
        left: props.leftPane.view === 'layer' ? 'transcript' : 'facsimile',
        right: props.rightPane.view === 'layer' ? 'transcript' : 'facsimile',
    },
);

watch(display, (value) => paneTabMemory.set(props.witness.id, { ...value }), {
    deep: true,
    immediate: true,
});

// A navigation replaces the payloads — resync what a pane shows, but ONLY
// when its server-side view actually changed: every successful post reloads
// the props, and resyncing on identity rather than value flipped a
// client-side facsimile tab back to transcript after each save (real bug —
// mapping text to the facsimile snapped the pane away from it).
watch(
    () => props.leftPane.view,
    (view, old) => {
        if (view !== old) {
            display.value = {
                ...display.value,
                left: view === 'layer' ? 'transcript' : 'facsimile',
            };
        }
    },
);
watch(
    () => props.rightPane.view,
    (view, old) => {
        if (view !== old) {
            display.value = {
                ...display.value,
                right: view === 'layer' ? 'transcript' : 'facsimile',
            };
        }
    },
);

function payloadFor(side: Side): PanePayload {
    return side === 'left' ? props.leftPane : props.rightPane;
}

function otherSide(side: Side): Side {
    return side === 'left' ? 'right' : 'left';
}

const leftPaneEl = ref<InstanceType<typeof TranscriptPane> | null>(null);
const rightPaneEl = ref<InstanceType<typeof TranscriptPane> | null>(null);

function setPaneEl(side: Side, el: unknown) {
    const pane = el as InstanceType<typeof TranscriptPane> | null;

    if (side === 'left') {
        leftPaneEl.value = pane;
    } else {
        rightPaneEl.value = pane;
    }
}

function paneEl(side: Side) {
    return side === 'left' ? leftPaneEl.value : rightPaneEl.value;
}

/** Resolves true only when BOTH panes' op logs saved clean. */
function flushBoth(): Promise<boolean> {
    return Promise.all([
        leftPaneEl.value?.flushAll() ?? Promise.resolve(true),
        rightPaneEl.value?.flushAll() ?? Promise.resolve(true),
    ]).then((results) => results.every(Boolean));
}

/** The URL parameter describing what a side currently holds. */
function paneParam(side: Side): string {
    const payload = payloadFor(side);

    return payload.layer ? `layer-${payload.layer.id}` : 'facsimile';
}

function navigatePane(side: Side, layerId: number) {
    void flushBoth().then(() => {
        router.get(
            showWitnessRoute.url(props.witness),
            {
                left: side === 'left' ? `layer-${layerId}` : paneParam('left'),
                right:
                    side === 'right' ? `layer-${layerId}` : paneParam('right'),
            },
            { preserveScroll: true },
        );
    });
}

/** A layer this side could open that the other side doesn't hold. */
function defaultLayerFor(side: Side): number | null {
    const takenId = payloadFor(otherSide(side)).layer?.id ?? null;

    for (const transcript of props.transcripts) {
        for (const option of transcript.layers ?? []) {
            if (option.id !== takenId) {
                return option.id;
            }
        }
    }

    return null;
}

function setTab(side: Side, tab: PaneTab) {
    if (tab === 'facsimile') {
        display.value = { ...display.value, [side]: 'facsimile' };

        return;
    }

    if (payloadFor(side).layer) {
        display.value = { ...display.value, [side]: 'transcript' };

        return;
    }

    const layerId = defaultLayerFor(side);

    if (layerId !== null) {
        navigatePane(side, layerId);

        return;
    }

    // No transcript to open — show the empty state with its pointer.
    display.value = { ...display.value, [side]: 'transcript' };
}

function otherLayerIdFor(side: Side): number | null {
    return payloadFor(otherSide(side)).layer?.id ?? null;
}

// ---- shared page state: the Pages box between the panes ----
const pages = computed(() => props.witness.pages ?? []);
const images = computed(() => props.witness.images ?? []);
const selectedPageId = ref<number | null>(null);

const selectedPage = computed(
    () => pages.value.find((item) => item.id === selectedPageId.value) ?? null,
);

/** The first transcript payload open, for break-derived page annotations. */
const anyTranscriptPayload = computed(
    () =>
        [props.leftPane, props.rightPane].find(
            (payload) => payload.layer !== null,
        ) ?? null,
);

const placedPageIds = computed(() =>
    [props.leftPane, props.rightPane].flatMap((payload) =>
        payload.pageBreaks.map((item) => item.manuscript_page_id),
    ),
);

/**
 * Whether text stands before the first page begins, as its own entry —
 * "this page has no break yet" and "this text is on no page yet" are
 * different things.
 */
const hasUnplacedOpening = computed(() => {
    const first = anyTranscriptPayload.value?.pageBreaks[0];

    return first !== undefined && first.start_line > 0;
});

const firstPlacedPageLabel = computed(() => {
    const first = anyTranscriptPayload.value?.pageBreaks[0];

    return first
        ? (pages.value.find((item) => item.id === first.manuscript_page_id)
              ?.label ?? null)
        : null;
});

function selectPage(id: number | null) {
    selectedPageId.value = id;
    leftPaneEl.value?.clearSelection();
    rightPaneEl.value?.clearSelection();
}

/** The ordered list the arrows step through: the opening stretch, then pages. */
const pageSequence = computed<(number | null)[]>(() => [
    ...(hasUnplacedOpening.value ? [null] : []),
    ...pages.value.map((item) => item.id),
]);

function stepPage(direction: 1 | -1) {
    const sequence = pageSequence.value;

    if (sequence.length === 0) {
        return;
    }

    const index = sequence.indexOf(selectedPageId.value);
    const next = index === -1 ? 0 : index + direction;

    if (next >= 0 && next < sequence.length) {
        selectPage(sequence[next]);
    }
}

// Open on the first page a transcript actually places, so an editor lands
// where the text is. Falls back to the first page of the witness, and to
// nothing at all when none are recorded.
watch(
    [pages, anyTranscriptPayload],
    () => {
        const stillThere = pages.value.some(
            (item) => item.id === selectedPageId.value,
        );

        if (stillThere) {
            return;
        }

        selectedPageId.value =
            anyTranscriptPayload.value?.pageBreaks[0]?.manuscript_page_id ??
            pages.value[0]?.id ??
            null;
    },
    { immediate: true },
);

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

// Deleting cascades server-side: the page's photographs (with their
// alignments) and every layer's break at it go too — the text itself is
// untouched, it simply stops being divided there.
function deletePage(item: ManuscriptPage) {
    const confirmed = window.confirm(
        `Delete page ${item.label}? Its photograph and the mappings of text onto it are deleted, and the text standing on it joins the previous page (in every transcript). Citations to work passages are untouched.`,
    );

    if (!confirmed) {
        return;
    }

    router.delete(destroyManuscriptPage.url(item.id), {
        preserveScroll: true,
    });
}

function pageHasImage(item: ManuscriptPage): boolean {
    return images.value.some((image) => image.manuscript_page_id === item.id);
}

/** Swap the page with its neighbour in the witness's page order. */
function movePage(item: ManuscriptPage, direction: 'up' | 'down') {
    router.patch(
        updateManuscriptPage.url(item.id),
        { direction },
        { preserveScroll: true },
    );
}

// Placement acts on whichever pane holds a selection (the floating actions
// there are where the selection was made).
const paneHasSelection = ref<Record<Side, boolean>>({
    left: false,
    right: false,
});
const lastSelectionSide = ref<Side | null>(null);

function onSelectionChanged(side: Side, has: boolean) {
    paneHasSelection.value = { ...paneHasSelection.value, [side]: has };

    if (has) {
        lastSelectionSide.value = side;
    }
}

const placementSide = computed<Side | null>(() => {
    if (
        lastSelectionSide.value &&
        paneHasSelection.value[lastSelectionSide.value]
    ) {
        return lastSelectionSide.value;
    }

    if (paneHasSelection.value.left) {
        return 'left';
    }

    if (paneHasSelection.value.right) {
        return 'right';
    }

    return null;
});

const selectedPageIsPlaced = computed(() =>
    placedPageIds.value.includes(selectedPageId.value ?? -1),
);

function placeSelectedPage() {
    if (placementSide.value === null || selectedPageId.value === null) {
        return;
    }

    paneEl(placementSide.value)?.placePage(selectedPageId.value);
}

// ---- facsimile state, shared so a transcript pane and a facsimile pane
// stay coupled: which image, which region is hovered or being adjusted.
const selectedImageId = ref<number | null>(null);

const imagesForSelectedPage = computed(() =>
    images.value.filter(
        (image) => image.manuscript_page_id === selectedPageId.value,
    ),
);

const selectedImage = computed(
    () =>
        images.value.find((image) => image.id === selectedImageId.value) ??
        null,
);

// The leaf follows the page. Freshly uploaded images arrive by a normal
// prop reload, and this picks them up with everything else.
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

const hoveredRegionId = ref<number | null>(null);
const editableRegionId = ref<number | null>(null);

function selectRegionForEditing(id: number) {
    if (!canEdit.value) {
        return;
    }

    editableRegionId.value = editableRegionId.value === id ? null : id;
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

/** Regions for a facsimile pane's overlay: the layer open opposite. */
function regionsOpposite(side: Side) {
    return payloadFor(otherSide(side)).layer?.regions ?? [];
}

// ---- drawing coordination: a transcript pane arms, the facsimile opposite
// receives the box, and the arming pane posts it (it owns the selection,
// the granularity and the flush).
const drawingSource = ref<Side | null>(null);

function onArmDrawing(side: Side) {
    drawingSource.value = side;
    // Drawing happens on the leaf — bring the facsimile up opposite.
    display.value = { ...display.value, [otherSide(side)]: 'facsimile' };
}

function onCancelDrawing(side: Side) {
    if (drawingSource.value === side) {
        drawingSource.value = null;
    }
}

function onRegionDrawn(box: {
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    if (drawingSource.value === null || selectedImageId.value === null) {
        return;
    }

    paneEl(drawingSource.value)?.completeRegion(box, selectedImageId.value);
}

/**
 * A paste into one pane matched a copy from the other layer: once both
 * panes' pending edits are saved (the posted offsets must be into saved
 * text on BOTH sides), ask the server to bring the copied range's
 * citations and facsimile mappings along.
 */
function onImportSpans(request: {
    targetLayerId: number;
    sourceLayerId: number;
    sourceStart: number;
    sourceEnd: number;
    targetOffset: number;
}) {
    void flushBoth().then((flushed) => {
        // Unsaved ops mean the server hasn't seen the pasted text yet —
        // its match guard would refuse the import against stale offsets.
        if (!flushed) {
            return;
        }

        router.post(
            storeSpanCopy.url(request.targetLayerId),
            {
                source_layer_id: request.sourceLayerId,
                source_start: request.sourceStart,
                source_end: request.sourceEnd,
                target_offset: request.targetOffset,
            },
            {
                preserveScroll: true,
                only: ['leftPane', 'rightPane', 'flash'],
            },
        );
    });
}

function drawingEnabledFor(side: Side): boolean {
    return (
        drawingSource.value !== null &&
        drawingSource.value !== side &&
        display.value[side] === 'facsimile'
    );
}

const sides: Side[] = ['left', 'right'];
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
                    <!-- Labelled rows, values aligned in one column; a row
                         with nothing to say does not appear. -->
                    <div
                        class="mt-1 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-0.5"
                    >
                        <template v-if="props.witness.repository">
                            <span
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >Repository</span
                            >
                            <span class="text-stone-600 dark:text-stone-400">{{
                                props.witness.repository
                            }}</span>
                        </template>
                        <template v-if="props.witness.shelfmark">
                            <span
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >Shelfmark</span
                            >
                            <span class="text-stone-600 dark:text-stone-400">{{
                                props.witness.shelfmark
                            }}</span>
                        </template>
                        <template v-if="props.witness.description">
                            <span
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >Description</span
                            >
                            <span>
                                <button
                                    type="button"
                                    class="text-xs text-stone-500 underline dark:text-stone-400"
                                    @click="showDescription = !showDescription"
                                >
                                    {{ showDescription ? 'Hide' : 'Show' }}
                                </button>
                                <span
                                    v-if="showDescription"
                                    class="mt-0.5 block max-w-prose text-stone-600 dark:text-stone-400"
                                >
                                    {{ props.witness.description }}
                                </span>
                            </span>
                        </template>
                        <template v-if="props.witnessOptions.length > 1">
                            <label
                                for="change-witness"
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >Change witness</label
                            >
                            <span>
                                <select
                                    id="change-witness"
                                    :value="props.witness.id"
                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-700"
                                    @change="
                                        openWitness(
                                            Number(
                                                (
                                                    $event.target as HTMLSelectElement
                                                ).value,
                                            ),
                                        )
                                    "
                                >
                                    <option
                                        v-for="option in props.witnessOptions"
                                        :key="option.id"
                                        :value="option.id"
                                    >
                                        {{ option.siglum
                                        }}{{
                                            option.label
                                                ? ` — ${option.label}`
                                                : ''
                                        }}
                                    </option>
                                </select>
                            </span>
                        </template>
                    </div>

                    <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        <template v-if="canEdit">
                            <button
                                type="button"
                                class="text-stone-500 underline dark:text-stone-400"
                                @click="addTranscript"
                            >
                                + Add transcript
                            </button>
                            <button
                                type="button"
                                class="text-stone-500 underline dark:text-stone-400"
                                @click="editingWitness = true"
                            >
                                Edit witness
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

            <!-- Two symmetric panes with the shared Pages box between them.
                 Left and right are places to put things: any layer of any
                 transcript, or the facsimile, opens on either side. -->
            <div
                class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_11rem_minmax(0,1fr)]"
            >
                <template v-for="(side, index) in sides" :key="side">
                    <div>
                        <!-- The pane's tabs. -->
                        <div
                            class="mb-3 flex items-center gap-1 border-b border-stone-200 pb-2 text-xs dark:border-stone-800"
                        >
                            <button
                                v-for="tab in [
                                    'transcript',
                                    'facsimile',
                                ] as const"
                                :key="tab"
                                type="button"
                                class="rounded border px-3 py-1 capitalize"
                                :class="
                                    display[side] === tab
                                        ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                        : 'border-stone-300 dark:border-stone-700'
                                "
                                @click="setTab(side, tab)"
                            >
                                {{ tab }}
                            </button>
                        </div>

                        <template v-if="display[side] === 'transcript'">
                            <TranscriptPane
                                v-if="payloadFor(side).layer"
                                :ref="(el) => setPaneEl(side, el)"
                                :pane="payloadFor(side)"
                                :transcripts="props.transcripts"
                                :works="props.works"
                                :selected-page-id="selectedPageId"
                                :other-layer-id="otherLayerIdFor(side)"
                                :hovered-region-id="hoveredRegionId"
                                @navigate="(id) => navigatePane(side, id)"
                                @selection-changed="
                                    (has) => onSelectionChanged(side, has)
                                "
                                @arm-drawing="onArmDrawing(side)"
                                @cancel-drawing="onCancelDrawing(side)"
                                @hover-region="(id) => (hoveredRegionId = id)"
                                @import-spans="onImportSpans"
                            />
                            <p
                                v-else
                                class="rounded border border-stone-200 p-4 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400"
                            >
                                <template v-if="props.transcripts.length === 0">
                                    This witness has no transcript yet.
                                    <template v-if="canEdit">
                                        Choose &ldquo;Add transcript&rdquo; in
                                        the Witness box to start one — both
                                        layers are created at once.
                                    </template>
                                </template>
                                <template v-else>
                                    Every layer is already open in the other
                                    pane.
                                </template>
                            </p>
                        </template>

                        <FacsimilePane
                            v-else
                            :witness="props.witness"
                            :selected-page="selectedPage"
                            :selected-image="selectedImage"
                            :regions="regionsOpposite(side)"
                            :hovered-region-id="hoveredRegionId"
                            :editable-region-id="editableRegionId"
                            :drawing-enabled="drawingEnabledFor(side)"
                            :can-edit="canEdit"
                            :pages-count="pages.length"
                            @region-drawn="onRegionDrawn"
                            @select-region="selectRegionForEditing"
                            @deselect="editableRegionId = null"
                            @hover-region="(id) => (hoveredRegionId = id)"
                            @remove-region="removeRegion"
                        />
                    </div>

                    <!-- The Pages box sits between the panes: the shared
                         division both panes follow. -->
                    <fieldset
                        v-if="index === 0"
                        class="flex h-full flex-col rounded-lg border border-stone-300 px-3 pb-3 text-xs dark:border-stone-700"
                    >
                        <legend
                            class="px-1 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
                        >
                            Pages
                        </legend>

                        <div class="mb-2 flex items-center justify-between">
                            <button
                                type="button"
                                class="rounded border border-stone-300 px-2 py-1 disabled:opacity-40 dark:border-stone-700"
                                title="Previous page"
                                :disabled="
                                    pageSequence.indexOf(selectedPageId) <= 0
                                "
                                @click="stepPage(-1)"
                            >
                                &larr;
                            </button>
                            <span class="text-stone-500 dark:text-stone-400">
                                {{
                                    selectedPage?.label ??
                                    (selectedPageId === null &&
                                    hasUnplacedOpening
                                        ? `before ${firstPlacedPageLabel}`
                                        : '—')
                                }}
                            </span>
                            <button
                                type="button"
                                class="rounded border border-stone-300 px-2 py-1 disabled:opacity-40 dark:border-stone-700"
                                title="Next page"
                                :disabled="
                                    pageSequence.indexOf(selectedPageId) >=
                                    pageSequence.length - 1
                                "
                                @click="stepPage(1)"
                            >
                                &rarr;
                            </button>
                        </div>

                        <!-- Add sits ABOVE the list, so it never moves down as pages
                             accumulate. -->
                        <form
                            v-if="canEdit"
                            class="mb-2 flex items-center gap-1"
                            @submit.prevent="addPage"
                        >
                            <input
                                v-model="newPageLabel"
                                type="text"
                                placeholder="e.g. 13r"
                                class="w-full min-w-0 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            />
                            <button
                                type="submit"
                                class="rounded border border-stone-300 px-2 py-1 whitespace-nowrap disabled:opacity-50 dark:border-stone-700"
                                :disabled="!newPageLabel.trim()"
                            >
                                Add
                            </button>
                        </form>

                        <button
                            v-if="
                                canEdit &&
                                selectedPage &&
                                placementSide !== null
                            "
                            type="button"
                            class="mb-2 w-full rounded border border-amber-300 px-2 py-1 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                            @click="placeSelectedPage"
                        >
                            {{ selectedPageIsPlaced ? 'Move' : 'Start' }}
                            {{ selectedPage.label }} at selection
                        </button>
                        <p
                            v-else-if="
                                canEdit && selectedPage && !selectedPageIsPlaced
                            "
                            class="mb-2 text-amber-700 dark:text-amber-400"
                        >
                            {{ selectedPage.label }} has no text placed on it
                            yet. Select its first words in a transcript, then
                            press &ldquo;Start {{ selectedPage.label }} at
                            selection&rdquo;.
                        </p>

                        <div
                            class="min-h-40 flex-1 overflow-y-auto rounded border border-stone-200 dark:border-stone-800"
                        >
                            <button
                                v-if="hasUnplacedOpening"
                                type="button"
                                class="block w-full px-2 py-1 text-left"
                                :class="
                                    selectedPageId === null
                                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                        : ''
                                "
                                title="Text standing before the first page begins"
                                @click="selectPage(null)"
                            >
                                before {{ firstPlacedPageLabel }}
                            </button>
                            <div
                                v-for="item in pages"
                                :key="item.id"
                                class="flex items-center"
                                :class="
                                    selectedPageId === item.id
                                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                        : ''
                                "
                            >
                                <span
                                    v-if="canEdit"
                                    class="flex flex-col pl-0.5 leading-none"
                                >
                                    <button
                                        type="button"
                                        class="px-0.5 text-[8px] opacity-40 hover:opacity-100"
                                        :title="`Move ${item.label} up`"
                                        @click="movePage(item, 'up')"
                                    >
                                        &#9650;
                                    </button>
                                    <button
                                        type="button"
                                        class="px-0.5 text-[8px] opacity-40 hover:opacity-100"
                                        :title="`Move ${item.label} down`"
                                        @click="movePage(item, 'down')"
                                    >
                                        &#9660;
                                    </button>
                                </span>
                                <button
                                    type="button"
                                    class="min-w-0 flex-1 px-2 py-1 text-left"
                                    :class="
                                        placedPageIds.includes(item.id)
                                            ? ''
                                            : 'text-stone-400 dark:text-stone-600'
                                    "
                                    :title="
                                        placedPageIds.includes(item.id)
                                            ? undefined
                                            : 'No text placed on this page yet'
                                    "
                                    @click="selectPage(item.id)"
                                >
                                    {{ item.label }}
                                </button>
                                <span
                                    v-if="pageHasImage(item)"
                                    title="Has a facsimile image"
                                    class="px-0.5"
                                    >📜</span
                                >
                                <button
                                    v-if="canEdit"
                                    type="button"
                                    class="px-1.5 py-1 opacity-50 hover:opacity-100"
                                    :title="`Delete page ${item.label}`"
                                    @click="deletePage(item)"
                                >
                                    🗑
                                </button>
                            </div>
                            <p
                                v-if="pages.length === 0"
                                class="px-2 py-2 text-stone-400 dark:text-stone-600"
                            >
                                No pages yet.
                            </p>
                        </div>
                    </fieldset>
                </template>
            </div>
        </div>
    </div>
</template>
