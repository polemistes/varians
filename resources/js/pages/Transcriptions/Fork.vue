<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { store } from '@/routes/transcriptions/fork';
import { show as showWitness } from '@/routes/witnesses';
import type {
    Transcription,
    TranscriptionLayer,
    Witness,
} from '@/types/models';

const props = defineProps<{
    transcription: Transcription;
    witnesses: Witness[];
}>();

// Witness and layer together name the slot the copy fills. Defaults to the
// other layer of this witness, which is the commonest copy: starting a
// witness's normalized layer from its diplomatic one, or the reverse.
const form = useForm({
    witness_id: props.transcription.witness_id as number | '',
    layer: (props.transcription.layer === 'diplomatic'
        ? 'normalized'
        : 'diplomatic') as TranscriptionLayer,
    tags: [] as string[],
});
const newTagInput = ref('');

function addTag() {
    const value = newTagInput.value.trim();

    if (!value || form.tags.includes(value)) {
        return;
    }

    form.tags.push(value);
    newTagInput.value = '';
}

function removeTag(name: string) {
    form.tags = form.tags.filter((tag) => tag !== name);
}

function submit() {
    form.post(store.url(props.transcription.id));
}
</script>

<template>
    <Head title="Fork transcription" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-xl">
            <AppHeader />

            <Link
                :href="showWitness.url(props.transcription.witness_id)"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; {{ props.transcription.witness?.siglum }}
            </Link>

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">
                Fork {{ props.transcription.witness?.siglum }}
            </h1>
            <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">
                Copies this transcription's text (and its citation assignments)
                into another slot, so it can be adapted without altering the
                original — onto another witness, to reflect what that manuscript
                shows, or onto this witness's other layer, to start its
                normalized text from its diplomatic one or the reverse. A
                witness holds one transcription per layer, so the slot you
                choose must be empty.
            </p>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Target witness
                    <select
                        v-model="form.witness_id"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    >
                        <option value="" disabled>
                            Choose a witness&hellip;
                        </option>
                        <option
                            v-for="witness in props.witnesses"
                            :key="witness.id"
                            :value="witness.id"
                        >
                            {{ witness.siglum }} &mdash; {{ witness.label }} ({{
                                witness.type
                            }})
                        </option>
                    </select>
                    <span
                        v-if="form.errors.witness_id"
                        class="text-xs text-red-600 dark:text-red-400"
                    >
                        {{ form.errors.witness_id }}
                    </span>
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Target layer
                    <select
                        v-model="form.layer"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    >
                        <option value="diplomatic">
                            diplomatic &mdash; what the manuscript physically
                            has
                        </option>
                        <option value="normalized">
                            normalized &mdash; the editor's regularization;
                            collation runs on this
                        </option>
                    </select>
                    <span
                        v-if="form.errors.layer"
                        class="text-xs text-red-600 dark:text-red-400"
                    >
                        {{ form.errors.layer }}
                    </span>
                </label>

                <div class="flex flex-col gap-1 text-sm">
                    Tags
                    <div class="flex flex-wrap items-center gap-2">
                        <span
                            v-for="tag in form.tags"
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
                            placeholder="+ tag"
                            class="w-28 rounded border border-dashed border-stone-300 bg-transparent px-2 py-0.5 text-xs dark:border-stone-700"
                            @keydown.enter.prevent="addTag()"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="form.processing || !form.witness_id"
                >
                    {{ form.processing ? 'Creating…' : 'Create fork' }}
                </button>
            </form>
        </div>
    </div>
</template>
