<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AlignableText from '@/components/AlignableText.vue';
import type { TranscriptionSegment } from '@/types/models';

/**
 * One layer of one witness, already trimmed by the server to the stretch
 * covering the passages on screen, with segment offsets rebased onto that
 * slice — see EditionController::windowSlice().
 */
export type WitnessTranscript = {
    id: number;
    witness_id: number;
    siglum: string;
    layer: string;
    text: string;
    segments: TranscriptionSegment[];
    covers_window: boolean;
};

const props = defineProps<{
    transcripts: WitnessTranscript[];
}>();

const LAYER_LABELS: Record<string, string> = {
    diplomatic: 'Diplomatic',
    normalized: 'Normalized',
};

/** Sigla in the server's order, which is already sorted. */
const sigla = computed(() => [
    ...new Set(props.transcripts.map((t) => t.siglum)),
]);

const activeSiglum = ref<string | null>(sigla.value[0] ?? null);

const layersForWitness = computed(() =>
    props.transcripts.filter((t) => t.siglum === activeSiglum.value),
);

// The diplomatic layer first where a witness has one — it is the manuscript
// itself, and the reason for opening this pane at all. Not every witness has
// both, so the choice is remembered by name and re-resolved per witness
// rather than held as an index into a list that changes underneath it.
const activeLayer = ref<string | null>(null);

const activeTranscript = computed(
    () =>
        layersForWitness.value.find((t) => t.layer === activeLayer.value) ??
        layersForWitness.value[0] ??
        null,
);

watch(
    sigla,
    (available) => {
        if (
            activeSiglum.value === null ||
            !available.includes(activeSiglum.value)
        ) {
            activeSiglum.value = available[0] ?? null;
        }
    },
    { immediate: true },
);

function selectWitness(siglum: string) {
    activeSiglum.value = siglum;
}
</script>

<template>
    <section
        class="mb-6 rounded-lg border border-stone-200 p-3 text-xs dark:border-stone-800"
    >
        <h3
            class="mb-2 font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
        >
            The manuscripts
        </h3>
        <p class="mb-2 text-stone-500 dark:text-stone-400">
            A witness's own text for the passages shown beside it, with its
            citation labels.
        </p>

        <div
            v-if="sigla.length"
            class="mb-2 flex flex-wrap items-center gap-1 border-b border-stone-200 pb-2 dark:border-stone-800"
        >
            <button
                v-for="siglum in sigla"
                :key="siglum"
                type="button"
                class="rounded px-2 py-1"
                :class="
                    activeSiglum === siglum
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'border border-stone-300 dark:border-stone-700'
                "
                @click="selectWitness(siglum)"
            >
                {{ siglum }}
            </button>

            <span
                v-if="layersForWitness.length > 1"
                class="ml-2 flex flex-wrap gap-1"
            >
                <button
                    v-for="transcript in layersForWitness"
                    :key="transcript.id"
                    type="button"
                    class="rounded border px-2 py-1"
                    :class="
                        activeTranscript?.id === transcript.id
                            ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                            : 'border-stone-300 dark:border-stone-700'
                    "
                    @click="activeLayer = transcript.layer"
                >
                    {{ LAYER_LABELS[transcript.layer] ?? transcript.layer }}
                </button>
            </span>
            <span
                v-else-if="activeTranscript"
                class="ml-2 text-stone-500 dark:text-stone-400"
            >
                {{
                    LAYER_LABELS[activeTranscript.layer] ??
                    activeTranscript.layer
                }}
                only
            </span>
        </div>
        <p v-else class="text-stone-500 dark:text-stone-400">
            No transcriptions of this work yet.
        </p>

        <template v-if="activeTranscript">
            <div
                v-if="activeTranscript.covers_window"
                class="rounded border border-stone-200 p-2 font-serif text-lg leading-loose dark:border-stone-800"
            >
                <AlignableText
                    :text="activeTranscript.text"
                    :segments="activeTranscript.segments"
                />
            </div>
            <p v-else class="text-stone-500 dark:text-stone-400">
                {{ activeTranscript.siglum }} has nothing for the passages shown
                — it may lack them, or cite them elsewhere in the work.
            </p>
        </template>
    </section>
</template>
