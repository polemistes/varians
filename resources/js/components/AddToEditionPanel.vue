<script setup lang="ts">
import { router, useForm } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import AlignableText from '@/components/AlignableText.vue';
import HierarchicalPassagePicker from '@/components/HierarchicalPassagePicker.vue';
import {
    store as storeEditionPassage,
    storeBulk as storeEditionPassageBulk,
} from '@/routes/edition-passages';
import type {
    Edition,
    ReferenceLevel,
    TranscriptionSegment,
} from '@/types/models';

type TranscriptionOption = {
    id: number;
    witness?: { id: number; siglum: string };
    text: string;
    segments: TranscriptionSegment[];
};

type PassageOption = {
    id: number;
    address: Record<string, string | number>;
};

const props = defineProps<{
    edition: Edition;
    transcriptions: TranscriptionOption[];
    alreadyAddedPassageIds: number[];
    passages: PassageOption[];
    referenceLevels: ReferenceLevel[];
}>();

const activeTranscriptionId = ref<number | null>(
    props.transcriptions[0]?.id ?? null,
);
const activeTranscription = computed(() =>
    props.transcriptions.find((t) => t.id === activeTranscriptionId.value),
);

// A segment is unavailable once its own canonical passage is already in
// this edition, from any transcription — greyed out rather than hidden, so
// the editor can still see what's already been decided while scanning this
// witness's text.
const unavailableSegmentIds = computed(() => {
    if (!activeTranscription.value) {
        return [];
    }

    return activeTranscription.value.segments
        .filter((segment) =>
            props.alreadyAddedPassageIds.includes(segment.canonical_passage_id),
        )
        .map((segment) => segment.id);
});

function selectTranscription(id: number) {
    activeTranscriptionId.value = id;
    selection.value = null;
    showBulkForm.value = false;
}

// Same interaction as the transcription editor: selecting is just
// selecting, and the "Add selection" button above the text acts on the
// remembered selection when PRESSED — no menu pops up at the selection.
const selection = ref<{ start: number; end: number; text: string } | null>(
    null,
);

function onSelect(sel: { start: number; end: number; text: string }) {
    selection.value = sel;
}

function onSelectionCleared() {
    selection.value = null;
}

function addSelection() {
    if (!activeTranscription.value || !selection.value) {
        return;
    }

    router.post(
        storeEditionPassage.url(props.edition),
        {
            transcription_layer_id: activeTranscription.value.id,
            start_offset: selection.value.start,
            end_offset: selection.value.end,
        },
        {
            preserveScroll: true,
            onSuccess: () => {
                selection.value = null;
            },
        },
    );
}

// "Select the whole text, press add, it is done" — the same single-span add
// action, just spanning the transcription's entire text.
function addWholeTranscription() {
    if (!activeTranscription.value) {
        return;
    }

    router.post(
        storeEditionPassage.url(props.edition),
        {
            transcription_layer_id: activeTranscription.value.id,
            start_offset: 0,
            end_offset: activeTranscription.value.text.length,
        },
        { preserveScroll: true },
    );
}

// ---- "base a range" — the bulk add, in the manuscript's own physical order ----
const showBulkForm = ref(false);
const bulkForm = useForm({
    from_canonical_passage_id: null as number | null,
    to_canonical_passage_id: null as number | null,
});

function toggleBulkForm() {
    showBulkForm.value = !showBulkForm.value;
    selection.value = null;
}

function submitBulk() {
    if (!activeTranscription.value) {
        return;
    }

    const transcriptionId = activeTranscription.value.id;

    bulkForm
        .transform((data) => ({
            ...data,
            transcription_layer_id: transcriptionId,
        }))
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
    <section
        class="mb-6 rounded-lg border border-stone-200 p-3 text-xs dark:border-stone-800"
    >
        <h3
            class="mb-2 font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
        >
            Add text
        </h3>
        <p class="mb-2 text-stone-500 dark:text-stone-400">
            Select a cited span from a transcription, then press &ldquo;Add
            selection&rdquo;.
        </p>

        <div
            v-if="transcriptions.length"
            class="mb-2 flex flex-wrap gap-1 border-b border-stone-200 pb-2 dark:border-stone-800"
        >
            <button
                v-for="transcription in transcriptions"
                :key="transcription.id"
                type="button"
                class="rounded px-2 py-1"
                :class="
                    activeTranscriptionId === transcription.id
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'border border-stone-300 dark:border-stone-700'
                "
                @click="selectTranscription(transcription.id)"
            >
                {{ transcription.witness?.siglum ?? `#${transcription.id}` }}
            </button>
        </div>
        <p v-else class="text-stone-500 dark:text-stone-400">
            No transcriptions of this work yet.
        </p>

        <template v-if="activeTranscription">
            <div class="mb-2 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    class="rounded border border-stone-300 px-2 py-1 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:text-stone-400"
                    :disabled="!selection"
                    :title="
                        selection
                            ? undefined
                            : 'Select text in the transcription below first'
                    "
                    @mousedown.prevent
                    @click="addSelection"
                >
                    Add selection
                </button>
                <button
                    type="button"
                    class="text-stone-600 underline dark:text-stone-400"
                    @click="addWholeTranscription"
                >
                    Add the whole text
                </button>
                <button
                    type="button"
                    class="text-stone-600 underline dark:text-stone-400"
                    @click="toggleBulkForm"
                >
                    {{
                        showBulkForm
                            ? 'Cancel'
                            : 'Base a range on this manuscript…'
                    }}
                </button>
            </div>

            <div
                class="mb-2 rounded border border-stone-200 p-2 font-serif text-lg leading-loose dark:border-stone-800"
            >
                <AlignableText
                    :text="activeTranscription.text"
                    :segments="activeTranscription.segments"
                    :unavailable-segment-ids="unavailableSegmentIds"
                    :selection-start="selection?.start ?? null"
                    :selection-end="selection?.end ?? null"
                    @select="onSelect"
                    @selection-cleared="onSelectionCleared"
                />
            </div>

            <form
                v-if="showBulkForm"
                class="flex flex-wrap items-center gap-2"
                @submit.prevent="submitBulk"
            >
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
        </template>
    </section>
</template>
