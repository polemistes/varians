<script setup lang="ts">
import { router, useForm } from '@inertiajs/vue3';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import AlignableText from '@/components/AlignableText.vue';
import HierarchicalSegmentPicker from '@/components/HierarchicalSegmentPicker.vue';
import ManuscriptImageViewer from '@/components/ManuscriptImageViewer.vue';
import {
    store as storeEditionSegment,
    storeBulk as storeEditionSegmentBulk,
} from '@/routes/edition-segments';
import type {
    Edition,
    ManuscriptImage,
    ReferenceLevel,
    TranscriptionRegion,
    Assignment,
} from '@/types/models';

/**
 * One layer of one transcript of one witness, cut to a run of its
 * manuscript pages — see EditionController::witnessPane. Every offset in
 * it (assignments, page breaks, regions) is the slice's own, counted from
 * `slice.start` of the layer's full text. A diplomatic entry names its
 * normalized sibling, the only layer an add may draw on.
 */
export type WitnessTranscript = {
    id: number;
    transcription_id: number;
    normalized_layer_id: number | null;
    name: string;
    witness_id: number;
    siglum: string;
    layer: string;
    first_sort_key: string;
    text: string;
    // Where in the layer's full text this stretch stands, which pages it
    // holds, and the pages a step back or on would start at.
    slice: {
        start: number;
        end: number;
        whole: boolean;
        page_ids: number[];
        previous_page_id: number | null;
        next_page_id: number | null;
    };
    assignments: Assignment[];
    part_totals?: Record<number, number>;
    // Where the manuscript's pages begin in this layer's text, and the
    // witness's pages with their photograph — see EditionController::pagesOf.
    page_breaks: {
        manuscript_page_id: number;
        start_line: number;
        start_offset: number;
        label: string;
    }[];
    pages: {
        id: number;
        label: string;
        position: number;
        image: ManuscriptImage | null;
    }[];
    // This layer's image alignments on the pages sent.
    regions: TranscriptionRegion[];
};

/**
 * What the pane asked the server for and got: one witness, a run of its
 * pages, in both layers. An optional Inertia prop — absent until asked
 * for, and absent again after any full visit.
 */
export type WitnessPane = {
    witness_id: number | null;
    page_id: number | null;
    // Every page a transcript of the witness starts somewhere — the pages
    // the pane can open at.
    transcribed_page_ids: number[];
    transcripts: WitnessTranscript[];
};

type SegmentOption = {
    id: number;
    address: Record<string, string | number>;
};

/**
 * The witnesses pane: the manuscripts of the work, one at a time, in
 * either layer, a few pages at a time — where a witness is read beside the
 * edition and where its assignments are picked for the edition (user
 * decision, merging the former "Add text" and "The manuscripts" panes).
 * Selecting text and pressing "Add selection" adds every assigned
 * assignment inside the selection; each lands where the manuscript has it
 * (SegmentAdder::insertionPosition). Assignments the edition already has
 * print grey.
 *
 * The text is fetched on demand (`witnessPane`, an optional prop): the
 * pane asks for the chosen witness when it mounts, when the witness
 * changes, when a step is taken through the pages, and again whenever a
 * full visit has dropped the prop — so the edition page itself carries no
 * transcript, however many witnesses of however many pages the work has.
 */
const props = defineProps<{
    edition: Edition;
    /** Every witness the pane may show, in the server's order (by siglum). */
    witnesses: { id: number; siglum: string }[];
    pane?: WitnessPane;
    alreadyAddedSegmentIds: number[];
    segments: SegmentOption[];
    referenceLevels: ReferenceLevel[];
    canEdit: boolean;
    // While a transposition is being registered the edition text is a
    // draft, and nothing may be added to it.
    locked: boolean;
    // The edition word under the pointer, as the spans of every witness
    // text it corresponds to (layer id + offsets), and its line — lit up
    // on the image, word by word.
    hoveredSpans: { layerId: number; start: number; end: number }[];
    hoveredSegmentId: number | null;
}>();

const emit = defineEmits<{
    // What the image region under the pointer is aligned to: spans of
    // witness text (the edition lights the words at those columns), or —
    // for a box mapped on the diplomatic layer alone — whole lines.
    (
        e: 'hover-image-region',
        target: {
            spans: { layerId: number; start: number; end: number }[];
            segmentIds: number[];
        },
    ): void;
}>();

/** The page props an add can change — see TEXT_PROPS in Editions/Show.vue. */
const ADD_PROPS = [
    'windowSegments',
    'segments',
    'workConjectures',
    'transpositions',
    'bibliography',
    'page',
    'totalPages',
    'witnesses',
    'flash',
];

const LAYER_LABELS: Record<string, string> = {
    diplomatic: 'Diplomatic',
    normalized: 'Normalized',
};

// Keyed by id, not siglum: sigla are conventional per work, not unique
// across the system.
const witnesses = computed(() => props.witnesses);

const activeWitnessId = ref<number | null>(witnesses.value[0]?.id ?? null);

watch(
    witnesses,
    (available) => {
        if (
            activeWitnessId.value === null ||
            !available.some((witness) => witness.id === activeWitnessId.value)
        ) {
            activeWitnessId.value = available[0]?.id ?? null;
        }
    },
    { immediate: true },
);

// ---- fetching. What was sent is shown only while it is the chosen
// witness's; until the chosen witness's own pages arrive the pane shows a
// skeleton, and while a further run of the same witness's pages is on
// its way the text it has dims. ----
const loading = ref(false);
// What is on its way, so the same ask made twice at once — the mount's
// and the witness watcher's, when the URL names a witness — goes once.
let inFlight: string | null = null;

const stale = computed(
    () =>
        props.pane === undefined ||
        props.pane.witness_id !== activeWitnessId.value,
);

const transcripts = computed<WitnessTranscript[]>(() =>
    stale.value ? [] : (props.pane?.transcripts ?? []),
);

/**
 * Ask for the chosen witness, from the page given — or, with none, from
 * the page where it has the edition's window. A partial reload of the
 * one prop: the rest of the page stays as it is, and the choice goes into
 * the URL, so the actions that follow keep it.
 */
function load(pageId: number | null) {
    const key = `${activeWitnessId.value}:${pageId ?? ''}`;

    if (activeWitnessId.value === null || inFlight === key) {
        return;
    }

    inFlight = key;
    loading.value = true;
    router.reload({
        only: ['witnessPane'],
        data: { witness: activeWitnessId.value, witness_page: pageId ?? '' },
        onFinish: () => {
            loading.value = false;
            inFlight = null;
        },
    });
}

watch(
    () => props.pane,
    (pane) => {
        // A full visit dropped the prop (a jump to another page of the
        // edition): follow the edition to where the witness has it.
        if (pane === undefined && !loading.value) {
            load(null);
        }
    },
);

const layersForWitness = computed(() =>
    transcripts.value.filter((t) => t.witness_id === activeWitnessId.value),
);

/** The layers this witness has at all — the toggle offers what exists. */
const availableLayers = computed(() =>
    ['diplomatic', 'normalized'].filter((layer) =>
        layersForWitness.value.some((t) => t.layer === layer),
    ),
);

// The diplomatic layer first where a witness has one — it is the manuscript
// itself. Remembered by name and re-resolved per witness.
const activeLayer = ref<string | null>(null);

const shownLayer = computed(() =>
    activeLayer.value !== null &&
    availableLayers.value.includes(activeLayer.value)
        ? activeLayer.value
        : (availableLayers.value[0] ?? null),
);

/**
 * The transcripts to show: every transcript of the witness in the shown
 * layer, in the order of their first assigned segment — a witness may hold
 * texts of the work in more than one transcript.
 */
const shownTranscripts = computed(() =>
    layersForWitness.value
        .filter((t) => t.layer === shownLayer.value)
        .sort((a, b) => (a.first_sort_key < b.first_sort_key ? -1 : 1)),
);

function pageBreaksFor(transcript: WitnessTranscript) {
    return transcript.page_breaks.map((item) => ({
        offset: item.start_offset,
        label: item.label,
        pageId: item.manuscript_page_id,
    }));
}

// ---- the image view. The page whose break stands at the top of the
// scrolled text is the page the Facsimile tab opens on; the image view has its
// own page selector; and going back to the text scrolls the page's first
// line to the top (user decision). ----
const view = ref<'text' | 'image'>('text');
const scrollEl = ref<HTMLElement | null>(null);
const pageAtTopId = ref<number | null>(null);
const selectedPageId = ref<number | null>(null);

/** The witness's pages, from whichever transcript is shown. */
const pages = computed(() => shownTranscripts.value[0]?.pages ?? []);

const selectedPage = computed(
    () => pages.value.find((page) => page.id === selectedPageId.value) ?? null,
);

/** The last page-break line that has scrolled past the top edge. */
function trackPageAtTop() {
    const container = scrollEl.value;

    if (!container) {
        return;
    }

    const top = container.getBoundingClientRect().top;
    let current: number | null = null;

    for (const marker of container.querySelectorAll<HTMLElement>(
        '[data-page-id]',
    )) {
        if (marker.getBoundingClientRect().top <= top + 4) {
            current = Number(marker.dataset.pageId);
        } else {
            break;
        }
    }

    pageAtTopId.value = current;
}

let trackScheduled = false;

function onScroll() {
    if (trackScheduled) {
        return;
    }

    trackScheduled = true;
    requestAnimationFrame(() => {
        trackScheduled = false;
        trackPageAtTop();
    });
}

let mounted = true;

onMounted(() => {
    // The witness the URL names — the choice made before a full reload —
    // read once mounted, never at setup: the server renders the first
    // witness, and a first client render that differed would be a
    // hydration mismatch.
    const named = Number(
        new URLSearchParams(window.location.search).get('witness'),
    );

    if (witnesses.value.some((witness) => witness.id === named)) {
        activeWitnessId.value = named;
    }

    // After the page's own mount: it may put the pane away at once (a
    // remembered preference), and a pane put away asks for nothing.
    void nextTick(() => {
        if (mounted && stale.value) {
            load(null);
        }
    });

    trackPageAtTop();
    window.addEventListener('resize', onScroll);
});
onUnmounted(() => {
    mounted = false;
    window.removeEventListener('resize', onScroll);
});

function showImage() {
    selectedPageId.value =
        pageAtTopId.value ?? selectedPageId.value ?? pages.value[0]?.id ?? null;
    view.value = 'image';
}

function showText(layer?: string) {
    if (layer !== undefined) {
        activeLayer.value = layer;
    }

    emit('hover-image-region', { spans: [], segmentIds: [] });

    const wanted = selectedPageId.value;
    view.value = 'text';

    void nextTick(() => {
        const container = scrollEl.value;

        if (!container) {
            return;
        }

        const marker = container.querySelector<HTMLElement>(
            `[data-page-id="${wanted}"]`,
        );
        container.scrollTop = marker
            ? marker.getBoundingClientRect().top -
              container.getBoundingClientRect().top +
              container.scrollTop
            : 0;
        trackPageAtTop();
    });
}

// ---- image ↔ edition text, word by word, exactly as in the transcript
// editor. A mapping is one box in both layers (counterpart rows share a
// group); the edition's columns carry normalized offsets, so a box is
// matched through its normalized row and lit in both rows. A box mapped
// on the diplomatic layer alone (drawn while the layers were out of step
// and not healed since) falls back to the line its assignment covers. ----
type ImageRegion = { region: TranscriptionRegion; layer: WitnessTranscript };

const imageRegions = computed<ImageRegion[]>(() => {
    const imageId = selectedPage.value?.image?.id;

    if (view.value !== 'image' || imageId === undefined) {
        return [];
    }

    return layersForWitness.value.flatMap((layer) =>
        layer.regions
            .filter((region) => region.manuscript_image_id === imageId)
            .map((region) => ({ region, layer })),
    );
});

/** The boxes of the image, each with its rows in either layer. */
const regionGroups = computed(() => {
    const groups = new Map<string, ImageRegion[]>();

    for (const item of imageRegions.value) {
        const key = item.region.group_id ?? `region-${item.region.id}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }

    return [...groups.values()];
});

function overlaps(
    a: { start: number; end: number },
    b: { start_offset: number; end_offset: number },
): boolean {
    return a.start < b.end_offset && a.end > b.start_offset;
}

function segmentsOf(region: TranscriptionRegion, layer: WitnessTranscript) {
    return [
        ...new Set(
            layer.assignments
                .filter((assignment) =>
                    overlaps(
                        { start: region.start_offset, end: region.end_offset },
                        assignment,
                    ),
                )
                .map((assignment) => assignment.segment_id),
        ),
    ];
}

function normalizedRows(group: ImageRegion[]): ImageRegion[] {
    return group.filter(({ layer }) => layer.layer === 'normalized');
}

const highlightedRegionIds = computed(() =>
    regionGroups.value
        .filter((group) => {
            const rows = normalizedRows(group);

            if (rows.length > 0) {
                // The edition's spans are the layer's own offsets; the
                // regions here are the slice's.
                return rows.some(({ region, layer }) =>
                    props.hoveredSpans.some(
                        (span) =>
                            span.layerId === layer.id &&
                            overlaps(
                                {
                                    start: span.start - layer.slice.start,
                                    end: span.end - layer.slice.start,
                                },
                                region,
                            ),
                    ),
                );
            }

            return (
                props.hoveredSegmentId !== null &&
                group.some(({ region, layer }) =>
                    segmentsOf(region, layer).includes(props.hoveredSegmentId!),
                )
            );
        })
        .flatMap((group) => group.map(({ region }) => region.id)),
);

function onHoverRegion(regionId: number | null) {
    const group = regionGroups.value.find((rows) =>
        rows.some(({ region }) => region.id === regionId),
    );

    if (!group) {
        emit('hover-image-region', { spans: [], segmentIds: [] });

        return;
    }

    const rows = normalizedRows(group);

    emit('hover-image-region', {
        spans: rows.map(({ region, layer }) => ({
            layerId: layer.id,
            start: region.start_offset + layer.slice.start,
            end: region.end_offset + layer.slice.start,
        })),
        segmentIds:
            rows.length > 0
                ? []
                : [
                      ...new Set(
                          group.flatMap(({ region, layer }) =>
                              segmentsOf(region, layer),
                          ),
                      ),
                  ],
    });
}

function stepPage(delta: -1 | 1) {
    const index = pages.value.findIndex(
        (page) => page.id === selectedPageId.value,
    );
    const next = pages.value[index + delta];

    if (next) {
        selectedPageId.value = next.id;
    }
}

// ---- the run of pages sent. The image view's page choice fetches the
// run starting at a page outside it, so its regions come along; the text
// view steps a run at a time, or opens at a page chosen. ----
const slicePageIds = computed(() =>
    shownTranscripts.value.flatMap((transcript) => transcript.slice.page_ids),
);

watch(selectedPageId, (pageId) => {
    if (
        pageId !== null &&
        view.value === 'image' &&
        !slicePageIds.value.includes(pageId) &&
        (props.pane?.transcribed_page_ids ?? []).includes(pageId)
    ) {
        load(pageId);
    }
});

/** The text view's pager: absent where the whole transcript is shown. */
const slicePager = computed(() => {
    const slice = shownTranscripts.value.find(
        (transcript) => !transcript.slice.whole,
    )?.slice;

    if (!slice) {
        return null;
    }

    const labelOf = (id: number) =>
        pages.value.find((page) => page.id === id)?.label ?? '';
    const first = slice.page_ids[0];
    const last = slice.page_ids[slice.page_ids.length - 1];

    return {
        previous: slice.previous_page_id,
        next: slice.next_page_id,
        // The run's extent; a single page is already named by the pulldown.
        label:
            first === undefined || first === last
                ? ''
                : `${labelOf(first)} – ${labelOf(last)}`,
    };
});

/** The page chosen in the text view's pulldown: the run starting there. */
const pagerPageId = computed({
    get: () => shownTranscripts.value[0]?.slice.page_ids[0] ?? null,
    set: (pageId: number | null) => {
        if (pageId !== null && !slicePageIds.value.includes(pageId)) {
            load(pageId);
        }
    },
});

function unavailableAssignmentIds(transcript: WitnessTranscript): number[] {
    return transcript.assignments
        .filter((assignment) =>
            props.alreadyAddedSegmentIds.includes(assignment.segment_id),
        )
        .map((assignment) => assignment.id);
}

// Same interaction as the transcription editor: selecting is just
// selecting, and "Add selection" acts on the remembered selection when
// pressed — no menu pops up at the selection.
const selection = ref<{
    transcriptId: number;
    start: number;
    end: number;
} | null>(null);

function onSelect(
    transcript: WitnessTranscript,
    sel: { start: number; end: number; text: string },
) {
    selection.value = {
        transcriptId: transcript.id,
        start: sel.start,
        end: sel.end,
    };
}

function onSelectionCleared(transcript: WitnessTranscript) {
    if (selection.value?.transcriptId === transcript.id) {
        selection.value = null;
    }
}

watch([activeWitnessId, shownLayer], () => {
    selection.value = null;
    showBulkForm.value = false;
    void nextTick(trackPageAtTop);
});

watch(activeWitnessId, () => {
    view.value = 'text';
    selectedPageId.value = null;
    load(null);
});

/** The assigned, not yet added segments fully inside the selection. */
const selectedSegmentIds = computed(() => {
    const sel = selection.value;
    const transcript = transcripts.value.find(
        (t) => t.id === sel?.transcriptId,
    );

    if (!sel || !transcript) {
        return [];
    }

    return [
        ...new Set(
            transcript.assignments
                .filter(
                    (assignment) =>
                        assignment.start_offset >= sel.start &&
                        assignment.end_offset <= sel.end &&
                        !props.alreadyAddedSegmentIds.includes(
                            assignment.segment_id,
                        ),
                )
                .map((assignment) => assignment.segment_id),
        ),
    ];
});

const canAdd = computed(
    () =>
        props.canEdit &&
        !props.locked &&
        selectedSegmentIds.value.length > 0 &&
        sourceLayerId(selection.value?.transcriptId ?? null) !== null,
);

function sourceLayerId(transcriptId: number | null): number | null {
    return (
        transcripts.value.find((t) => t.id === transcriptId)
            ?.normalized_layer_id ?? null
    );
}

function addSelection() {
    const layerId = sourceLayerId(selection.value?.transcriptId ?? null);

    if (!canAdd.value || layerId === null) {
        return;
    }

    router.post(
        storeEditionSegment.url(props.edition),
        {
            transcription_layer_id: layerId,
            segment_ids: selectedSegmentIds.value,
        },
        {
            // What adding changes: the text, the paging, which witnesses
            // the edition draws on — never this pane's own transcript.
            only: ADD_PROPS,
            preserveScroll: true,
            onSuccess: () => {
                selection.value = null;
            },
        },
    );
}

// ---- "Add lines…" — the bulk add: an assignment range from this witness ----
const showBulkForm = ref(false);
const bulkForm = useForm({
    from_segment_id: null as number | null,
    to_segment_id: null as number | null,
});

const bulkSourceLayerId = computed(
    () =>
        shownTranscripts.value
            .map((t) => t.normalized_layer_id)
            .find((id) => id !== null) ?? null,
);

function toggleBulkForm() {
    showBulkForm.value = !showBulkForm.value;
    selection.value = null;
}

function submitBulk() {
    const layerId = bulkSourceLayerId.value;

    if (layerId === null) {
        return;
    }

    bulkForm
        .transform((data) => ({ ...data, transcription_layer_id: layerId }))
        .post(storeEditionSegmentBulk.url(props.edition), {
            only: ADD_PROPS,
            preserveScroll: true,
            onSuccess: () => {
                bulkForm.reset();
                showBulkForm.value = false;
            },
        });
}
</script>

<template>
    <fieldset
        class="rounded-lg border border-stone-200 px-3 pb-3 text-xs dark:border-stone-800"
    >
        <legend
            class="px-2 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
        >
            Witnesses
        </legend>

        <div
            v-if="witnesses.length"
            class="mb-2 flex min-h-9 flex-wrap items-center gap-1 border-b border-stone-200 pb-2 dark:border-stone-800"
        >
            <select
                v-model="activeWitnessId"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 font-serif dark:border-stone-700 dark:bg-stone-950"
                title="The witness shown"
            >
                <option
                    v-for="witness in witnesses"
                    :key="witness.id"
                    :value="witness.id"
                >
                    {{ witness.siglum }}
                </option>
            </select>

            <span class="ml-1 flex flex-wrap gap-1">
                <button
                    v-for="layer in availableLayers"
                    :key="layer"
                    type="button"
                    class="rounded border px-2 py-1"
                    :class="
                        view === 'text' && shownLayer === layer
                            ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                            : 'border-stone-300 dark:border-stone-700'
                    "
                    @click="showText(layer)"
                >
                    {{ LAYER_LABELS[layer] ?? layer }}
                </button>
                <button
                    type="button"
                    class="rounded border px-2 py-1 disabled:opacity-40"
                    :class="
                        view === 'image'
                            ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                            : 'border-stone-300 dark:border-stone-700'
                    "
                    :disabled="pages.length === 0"
                    :title="
                        pages.length === 0
                            ? 'No pages recorded for this witness yet'
                            : 'The photograph of the page at the top of the text'
                    "
                    @click="showImage"
                >
                    Facsimile
                </button>
            </span>

            <template v-if="canEdit">
                <button
                    type="button"
                    class="ml-auto rounded border border-stone-300 px-2 py-1 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:text-stone-400"
                    :disabled="!canAdd"
                    :title="
                        locked
                            ? 'Finish registering the transposition first'
                            : canAdd
                              ? 'Add the selected segments to the edition, each where the manuscript has it'
                              : 'Select assigned text in the transcript below first'
                    "
                    @mousedown.prevent
                    @click="addSelection"
                >
                    Add selection
                </button>
                <button
                    type="button"
                    class="text-stone-600 underline disabled:opacity-40 dark:text-stone-400"
                    :disabled="locked || bulkSourceLayerId === null"
                    @click="toggleBulkForm"
                >
                    {{ showBulkForm ? 'Cancel' : 'Add lines…' }}
                </button>
            </template>
        </div>
        <p v-else class="text-stone-500 dark:text-stone-400">
            No transcriptions of this work yet.
        </p>

        <!-- Until the chosen witness's pages arrive: the shape of a text. -->
        <div
            v-if="witnesses.length && stale"
            class="animate-pulse space-y-3 rounded border border-stone-200 p-3 dark:border-stone-800"
            aria-busy="true"
            aria-label="Loading the witness"
        >
            <div
                v-for="width in [
                    'w-11/12',
                    'w-4/5',
                    'w-full',
                    'w-3/4',
                    'w-5/6',
                ]"
                :key="width"
                class="h-4 rounded bg-stone-200 dark:bg-stone-800"
                :class="width"
            ></div>
        </div>

        <!-- The "Add lines…" dialogue sits between the row that opened it
             and the transcript it draws from — never below the text. -->
        <form
            v-if="showBulkForm && canEdit"
            class="mb-2 flex flex-wrap items-center gap-2 rounded border border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900/50"
            @submit.prevent="submitBulk"
        >
            <p class="w-full text-stone-500 dark:text-stone-400">
                Adds everything this witness has for a range of segments, each
                line where the manuscript has it. Lines already in the edition
                are left as they are.
            </p>
            <span class="text-stone-500 dark:text-stone-400">from</span>
            <HierarchicalSegmentPicker
                v-model="bulkForm.from_segment_id"
                :segments="segments"
                :levels="referenceLevels"
            />
            <span class="text-stone-500 dark:text-stone-400">to</span>
            <HierarchicalSegmentPicker
                v-model="bulkForm.to_segment_id"
                :segments="segments"
                :levels="referenceLevels"
            />
            <button
                type="submit"
                class="rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                :disabled="
                    bulkForm.processing ||
                    !bulkForm.from_segment_id ||
                    !bulkForm.to_segment_id
                "
            >
                Add
            </button>
            <span
                v-if="
                    bulkForm.errors.from_segment_id ||
                    bulkForm.errors.to_segment_id
                "
                class="block w-full text-red-600 dark:text-red-400"
            >
                {{
                    bulkForm.errors.from_segment_id ??
                    bulkForm.errors.to_segment_id
                }}
            </span>
        </form>

        <!-- The image view: the page at the top of the text when opened,
             then whichever page is chosen here. -->
        <div v-if="view === 'image' && !stale" class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    class="rounded border border-stone-300 px-2 py-1 disabled:opacity-40 dark:border-stone-700"
                    :disabled="
                        !selectedPage || pages[0]?.id === selectedPage.id
                    "
                    @click="stepPage(-1)"
                >
                    &larr;
                </button>
                <select
                    v-model="selectedPageId"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
                    title="The page shown"
                >
                    <option
                        v-for="page in pages"
                        :key="page.id"
                        :value="page.id"
                    >
                        {{ page.label
                        }}{{ page.image ? '' : ' (no photograph)' }}
                    </option>
                </select>
                <button
                    type="button"
                    class="rounded border border-stone-300 px-2 py-1 disabled:opacity-40 dark:border-stone-700"
                    :disabled="
                        !selectedPage ||
                        pages[pages.length - 1]?.id === selectedPage.id
                    "
                    @click="stepPage(1)"
                >
                    &rarr;
                </button>
            </div>
            <div
                class="max-h-[70vh] overflow-auto rounded border border-stone-200 dark:border-stone-800"
            >
                <ManuscriptImageViewer
                    v-if="selectedPage?.image"
                    :image="selectedPage.image"
                    :regions="imageRegions.map(({ region }) => region)"
                    :highlighted-region-ids="highlightedRegionIds"
                    @hover-region="onHoverRegion"
                />
                <p v-else class="p-4 text-stone-500 dark:text-stone-400">
                    <template v-if="selectedPage">
                        No photograph of {{ selectedPage.label }} yet.
                    </template>
                    <template v-else>Choose a page.</template>
                </p>
            </div>
        </div>

        <!-- The text, scrolling within the pane: the page whose break has
             scrolled past the top is what the Facsimile tab opens on. -->
        <div
            v-show="view === 'text' && !stale"
            ref="scrollEl"
            class="max-h-[70vh] overflow-y-auto"
            :class="loading && 'opacity-50'"
            @scroll="onScroll"
        >
            <template
                v-for="(transcript, index) in shownTranscripts"
                :key="transcript.id"
            >
                <p
                    v-if="shownTranscripts.length > 1"
                    class="mt-2 mb-1 text-stone-500 dark:text-stone-400"
                    :class="index > 0 ? 'mt-3' : ''"
                >
                    {{ transcript.name }}
                </p>
                <div
                    class="rounded border border-stone-200 p-2 font-serif text-lg leading-loose dark:border-stone-800"
                >
                    <AlignableText
                        :text="transcript.text"
                        :assignments="transcript.assignments"
                        :page-breaks="pageBreaksFor(transcript)"
                        :part-totals="transcript.part_totals ?? null"
                        :unavailable-assignment-ids="
                            unavailableAssignmentIds(transcript)
                        "
                        :selection-start="
                            selection?.transcriptId === transcript.id
                                ? selection.start
                                : null
                        "
                        :selection-end="
                            selection?.transcriptId === transcript.id
                                ? selection.end
                                : null
                        "
                        @select="onSelect(transcript, $event)"
                        @selection-cleared="onSelectionCleared(transcript)"
                    />
                </div>
            </template>
        </div>

        <!-- A run of pages at a time: step back or on by a run, or open at
             a page — below the text, so the frames' tops stay aligned. -->
        <div
            v-if="view === 'text' && !stale && slicePager"
            class="mt-2 flex flex-wrap items-center gap-2 text-stone-600 dark:text-stone-400"
        >
            <button
                type="button"
                class="rounded border border-stone-300 px-2 py-1 disabled:opacity-40 dark:border-stone-700"
                :disabled="loading || slicePager.previous === null"
                title="The pages before these"
                @click="load(slicePager.previous)"
            >
                &larr;
            </button>
            <select
                v-model="pagerPageId"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
                title="Open the text at a page"
                :disabled="loading"
            >
                <option
                    v-for="page in pages.filter((page) =>
                        (pane?.transcribed_page_ids ?? []).includes(page.id),
                    )"
                    :key="page.id"
                    :value="page.id"
                >
                    {{ page.label }}
                </option>
            </select>
            <span v-if="slicePager.label">{{ slicePager.label }}</span>
            <button
                type="button"
                class="rounded border border-stone-300 px-2 py-1 disabled:opacity-40 dark:border-stone-700"
                :disabled="loading || slicePager.next === null"
                title="The pages after these"
                @click="load(slicePager.next)"
            >
                &rarr;
            </button>
        </div>
    </fieldset>
</template>
