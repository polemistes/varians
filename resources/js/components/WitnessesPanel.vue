<script setup lang="ts">
import { router, useForm } from '@inertiajs/vue3';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import AlignableText from '@/components/AlignableText.vue';
import HierarchicalPassagePicker from '@/components/HierarchicalPassagePicker.vue';
import ManuscriptImageViewer from '@/components/ManuscriptImageViewer.vue';
import {
    store as storeEditionPassage,
    storeBulk as storeEditionPassageBulk,
} from '@/routes/edition-passages';
import type {
    Edition,
    ManuscriptImage,
    ReferenceLevel,
    TranscriptionRegion,
    TranscriptionSegment,
} from '@/types/models';

/**
 * One layer of one transcript of one witness, whole — see
 * EditionController::witnessTranscripts. A diplomatic entry names its
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
    segments: TranscriptionSegment[];
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
    // This layer's image alignments.
    regions: TranscriptionRegion[];
};

type PassageOption = {
    id: number;
    address: Record<string, string | number>;
};

/**
 * The witnesses pane: the manuscripts of the work, one at a time, in
 * either layer, whole — where a witness is read beside the edition and
 * where its segments are picked for the edition (user decision, merging
 * the former "Add text" and "The manuscripts" panes). Selecting text and
 * pressing "Add selection" adds every cited segment inside the selection;
 * each lands where the manuscript has it (PassageAdder::insertionPosition).
 * Segments the edition already has print grey.
 */
const props = defineProps<{
    edition: Edition;
    transcripts: WitnessTranscript[];
    alreadyAddedPassageIds: number[];
    passages: PassageOption[];
    referenceLevels: ReferenceLevel[];
    canEdit: boolean;
    // While a transposition is being registered the edition text is a
    // draft, and nothing may be added to it.
    locked: boolean;
    // The edition word under the pointer, as the spans of every witness
    // text it corresponds to (layer id + offsets), and its line — lit up
    // on the image, word by word.
    hoveredSpans: { layerId: number; start: number; end: number }[];
    hoveredPassageId: number | null;
}>();

const emit = defineEmits<{
    // What the image region under the pointer is aligned to: spans of
    // witness text (the edition lights the words at those columns), or —
    // for a box mapped on the diplomatic layer alone — whole lines.
    (
        e: 'hover-image-region',
        target: {
            spans: { layerId: number; start: number; end: number }[];
            passageIds: number[];
        },
    ): void;
}>();

const LAYER_LABELS: Record<string, string> = {
    diplomatic: 'Diplomatic',
    normalized: 'Normalized',
};

/**
 * Witnesses in the server's order (by siglum). Keyed by id, not siglum:
 * sigla are conventional per work, not unique across the system.
 */
const witnesses = computed(() => {
    const seen = new Map<number, string>();

    for (const transcript of props.transcripts) {
        if (!seen.has(transcript.witness_id)) {
            seen.set(transcript.witness_id, transcript.siglum);
        }
    }

    return [...seen.entries()].map(([id, siglum]) => ({ id, siglum }));
});

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

const layersForWitness = computed(() =>
    props.transcripts.filter((t) => t.witness_id === activeWitnessId.value),
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
 * layer, in the order of their first cited passage — a witness may hold
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

onMounted(() => {
    trackPageAtTop();
    window.addEventListener('resize', onScroll);
});
onUnmounted(() => window.removeEventListener('resize', onScroll));

function showImage() {
    selectedPageId.value =
        pageAtTopId.value ?? selectedPageId.value ?? pages.value[0]?.id ?? null;
    view.value = 'image';
}

function showText(layer?: string) {
    if (layer !== undefined) {
        activeLayer.value = layer;
    }

    emit('hover-image-region', { spans: [], passageIds: [] });

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
// and not healed since) falls back to the line its citation covers. ----
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

function passagesOf(region: TranscriptionRegion, layer: WitnessTranscript) {
    return [
        ...new Set(
            layer.segments
                .filter((segment) =>
                    overlaps(
                        { start: region.start_offset, end: region.end_offset },
                        segment,
                    ),
                )
                .map((segment) => segment.canonical_passage_id),
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
                return rows.some(({ region, layer }) =>
                    props.hoveredSpans.some(
                        (span) =>
                            span.layerId === layer.id && overlaps(span, region),
                    ),
                );
            }

            return (
                props.hoveredPassageId !== null &&
                group.some(({ region, layer }) =>
                    passagesOf(region, layer).includes(props.hoveredPassageId!),
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
        emit('hover-image-region', { spans: [], passageIds: [] });

        return;
    }

    const rows = normalizedRows(group);

    emit('hover-image-region', {
        spans: rows.map(({ region, layer }) => ({
            layerId: layer.id,
            start: region.start_offset,
            end: region.end_offset,
        })),
        passageIds:
            rows.length > 0
                ? []
                : [
                      ...new Set(
                          group.flatMap(({ region, layer }) =>
                              passagesOf(region, layer),
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

function unavailableSegmentIds(transcript: WitnessTranscript): number[] {
    return transcript.segments
        .filter((segment) =>
            props.alreadyAddedPassageIds.includes(segment.canonical_passage_id),
        )
        .map((segment) => segment.id);
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
});

/** The cited, not yet added passages fully inside the selection. */
const selectedPassageIds = computed(() => {
    const sel = selection.value;
    const transcript = props.transcripts.find(
        (t) => t.id === sel?.transcriptId,
    );

    if (!sel || !transcript) {
        return [];
    }

    return [
        ...new Set(
            transcript.segments
                .filter(
                    (segment) =>
                        segment.start_offset >= sel.start &&
                        segment.end_offset <= sel.end &&
                        !props.alreadyAddedPassageIds.includes(
                            segment.canonical_passage_id,
                        ),
                )
                .map((segment) => segment.canonical_passage_id),
        ),
    ];
});

const canAdd = computed(
    () =>
        props.canEdit &&
        !props.locked &&
        selectedPassageIds.value.length > 0 &&
        sourceLayerId(selection.value?.transcriptId ?? null) !== null,
);

function sourceLayerId(transcriptId: number | null): number | null {
    return (
        props.transcripts.find((t) => t.id === transcriptId)
            ?.normalized_layer_id ?? null
    );
}

function addSelection() {
    const layerId = sourceLayerId(selection.value?.transcriptId ?? null);

    if (!canAdd.value || layerId === null) {
        return;
    }

    router.post(
        storeEditionPassage.url(props.edition),
        {
            transcription_layer_id: layerId,
            canonical_passage_ids: selectedPassageIds.value,
        },
        {
            preserveScroll: true,
            onSuccess: () => {
                selection.value = null;
            },
        },
    );
}

// ---- "Add lines…" — the bulk add: a citation range from this witness ----
const showBulkForm = ref(false);
const bulkForm = useForm({
    from_canonical_passage_id: null as number | null,
    to_canonical_passage_id: null as number | null,
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
        .post(storeEditionPassageBulk.url(props.edition), {
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
                              : 'Select cited text in the transcript below first'
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

        <!-- The "Add lines…" dialogue sits between the row that opened it
             and the transcript it draws from — never below the text. -->
        <form
            v-if="showBulkForm && canEdit"
            class="mb-2 flex flex-wrap items-center gap-2 rounded border border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900/50"
            @submit.prevent="submitBulk"
        >
            <p class="w-full text-stone-500 dark:text-stone-400">
                Adds everything this witness has for a citation range, each line
                where the manuscript has it. Lines already in the edition are
                left as they are.
            </p>
            <span class="text-stone-500 dark:text-stone-400">from</span>
            <HierarchicalPassagePicker
                v-model="bulkForm.from_canonical_passage_id"
                :passages="passages"
                :levels="referenceLevels"
            />
            <span class="text-stone-500 dark:text-stone-400">to</span>
            <HierarchicalPassagePicker
                v-model="bulkForm.to_canonical_passage_id"
                :passages="passages"
                :levels="referenceLevels"
            />
            <button
                type="submit"
                class="rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                :disabled="
                    bulkForm.processing ||
                    !bulkForm.from_canonical_passage_id ||
                    !bulkForm.to_canonical_passage_id
                "
            >
                Add
            </button>
            <span
                v-if="
                    bulkForm.errors.from_canonical_passage_id ||
                    bulkForm.errors.to_canonical_passage_id
                "
                class="block w-full text-red-600 dark:text-red-400"
            >
                {{
                    bulkForm.errors.from_canonical_passage_id ??
                    bulkForm.errors.to_canonical_passage_id
                }}
            </span>
        </form>

        <!-- The image view: the page at the top of the text when opened,
             then whichever page is chosen here. -->
        <div v-if="view === 'image'" class="flex flex-col gap-2">
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
            v-show="view === 'text'"
            ref="scrollEl"
            class="max-h-[70vh] overflow-y-auto"
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
                        :segments="transcript.segments"
                        :page-breaks="pageBreaksFor(transcript)"
                        :part-totals="transcript.part_totals ?? null"
                        :unavailable-segment-ids="
                            unavailableSegmentIds(transcript)
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
    </fieldset>
</template>
