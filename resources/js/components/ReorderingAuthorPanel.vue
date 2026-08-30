<script setup lang="ts">
import { useForm } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import HierarchicalPassagePicker from '@/components/HierarchicalPassagePicker.vue';
import { store as storeConjectureOrdering } from '@/routes/conjecture-orderings';
import type { Edition, ReferenceLevel } from '@/types/models';

type RangePassage = {
    id: number;
    label: string;
    address: Record<string, string | number>;
};

const props = defineProps<{
    edition: Edition;
    passages: RangePassage[];
    referenceLevels: ReferenceLevel[];
}>();

const fromId = ref<number | null>(null);
const toId = ref<number | null>(null);

// The edition's own current order already gives us exactly what a
// reordering conjecture needs to start from — no separate lookup, since
// `passages` is already in the edition's own position order.
const rangePassages = computed<RangePassage[]>(() => {
    if (fromId.value === null || toId.value === null) {
        return [];
    }

    const fromIndex = props.passages.findIndex((p) => p.id === fromId.value);
    const toIndex = props.passages.findIndex((p) => p.id === toId.value);

    if (fromIndex === -1 || toIndex === -1) {
        return [];
    }

    const [start, end] =
        fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];

    return props.passages.slice(start, end + 1);
});

// The editor's working order — starts as the current edition order for the
// picked range, then rearranged freely via moveUp/moveDown before
// submitting. A plain move-up/move-down list rather than drag-and-drop —
// nothing here needs a new dependency for that.
const workingOrder = ref<RangePassage[]>([]);

function loadRange() {
    workingOrder.value = [...rangePassages.value];
}

function moveUp(index: number) {
    if (index === 0) {
        return;
    }

    const entries = workingOrder.value;
    [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
}

function moveDown(index: number) {
    if (index === workingOrder.value.length - 1) {
        return;
    }

    const entries = workingOrder.value;
    [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
}

const form = useForm({
    proposed_by: '',
    bibliography: '',
    note: '',
});

function submit() {
    form.transform((data) => ({
        ...data,
        canonical_passage_ids: workingOrder.value.map((p) => p.id),
    })).post(storeConjectureOrdering.url(props.edition), {
        preserveScroll: true,
        onSuccess: () => {
            fromId.value = null;
            toId.value = null;
            workingOrder.value = [];
            form.reset();
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
            Propose a reordering
        </h3>
        <p class="mb-2 text-stone-500 dark:text-stone-400">
            Pick a range already in the edition, then arrange its lines freely —
            the result joins the pool of orderings this range can follow,
            credited like any other conjecture.
        </p>

        <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="text-stone-500 dark:text-stone-400">from</span>
            <HierarchicalPassagePicker
                v-model="fromId"
                :passages="passages"
                :levels="referenceLevels"
            />
            <span class="text-stone-500 dark:text-stone-400">to</span>
            <HierarchicalPassagePicker
                v-model="toId"
                :passages="passages"
                :levels="referenceLevels"
            />
            <button
                type="button"
                class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50 dark:border-stone-700"
                :disabled="fromId === null || toId === null"
                @click="loadRange"
            >
                Load
            </button>
        </div>

        <ol v-if="workingOrder.length" class="mb-2 flex flex-col gap-1">
            <li
                v-for="(passage, index) in workingOrder"
                :key="passage.id"
                class="flex items-center justify-between gap-2 rounded border border-stone-200 px-2 py-1 dark:border-stone-800"
            >
                <span>{{ passage.label }}</span>
                <span class="flex gap-2">
                    <button
                        type="button"
                        class="underline disabled:opacity-30"
                        :disabled="index === 0"
                        @click="moveUp(index)"
                    >
                        &uarr;
                    </button>
                    <button
                        type="button"
                        class="underline disabled:opacity-30"
                        :disabled="index === workingOrder.length - 1"
                        @click="moveDown(index)"
                    >
                        &darr;
                    </button>
                </span>
            </li>
        </ol>

        <form
            v-if="workingOrder.length"
            class="flex flex-col gap-1"
            @submit.prevent="submit"
        >
            <input
                v-model="form.proposed_by"
                type="text"
                placeholder="First proposed by"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
            />
            <input
                v-model="form.bibliography"
                type="text"
                placeholder="Bibliography"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
            />
            <button
                type="submit"
                class="self-start rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                :disabled="form.processing"
            >
                Propose this order
            </button>
            <span
                v-if="Object.keys(form.errors).length"
                class="text-red-600 dark:text-red-400"
            >
                {{ Object.values(form.errors)[0] }}
            </span>
        </form>
    </section>
</template>
