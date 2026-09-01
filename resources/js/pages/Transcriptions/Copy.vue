<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { computed } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { store } from '@/routes/transcriptions/copy';
import { show as showWitness } from '@/routes/witnesses';
import type { Transcription, TranscriptionLayer } from '@/types/models';

const props = defineProps<{
    layer: TranscriptionLayer;
    transcriptions: Transcription[];
}>();

const otherLayer = computed(() =>
    props.layer.layer === 'diplomatic' ? 'normalized' : 'diplomatic',
);

// The destination transcription is the only choice: which layer receives the
// text follows from it. Defaults to this layer's own transcription, which is
// the commonest copy — starting the normalized text from the diplomatic one,
// or the reverse.
const form = useForm({
    transcription_id: props.layer.transcription_id as number | '',
});

const staysHere = computed(
    () => form.transcription_id === props.layer.transcription_id,
);

function submit() {
    form.post(store.url(props.layer.id));
}
</script>

<template>
    <Head title="Copy transcription layer" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-xl">
            <AppHeader />

            <Link
                :href="showWitness.url(props.layer.transcription!.witness!.id)"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; {{ props.layer.transcription?.witness?.siglum }}
            </Link>

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">
                Copy the {{ props.layer.layer }} layer
            </h1>
            <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">
                Copies this layer's text into another, leaving this one
                untouched. The layer it lands in follows from where you send it:
                within this transcription there is only the
                {{ otherLayer }} layer, and any other transcription receives it
                into its own {{ props.layer.layer }} layer.
            </p>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Copy into
                    <select
                        v-model="form.transcription_id"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    >
                        <option value="" disabled>
                            Choose a transcription&hellip;
                        </option>
                        <option
                            v-for="transcription in props.transcriptions"
                            :key="transcription.id"
                            :value="transcription.id"
                        >
                            {{ transcription.witness?.siglum }} &mdash;
                            {{ transcription.name
                            }}{{
                                transcription.id ===
                                props.layer.transcription_id
                                    ? ' (this one)'
                                    : ''
                            }}
                        </option>
                    </select>
                    <span
                        v-if="form.errors.transcription_id"
                        class="text-xs text-red-600 dark:text-red-400"
                    >
                        {{ form.errors.transcription_id }}
                    </span>
                </label>

                <p
                    class="rounded border border-stone-200 p-3 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400"
                >
                    <template v-if="staysHere">
                        The citation assignments and the image alignments come
                        with it: the other layer is this same manuscript text
                        regularized, standing on the same pages and the same
                        marks on parchment.
                    </template>
                    <template v-else>
                        Only the citation assignments come with it. Which
                        passage of a work a stretch of text is stays true
                        wherever it goes; where it sits on a manuscript page
                        does not, because that is a different manuscript.
                    </template>
                </p>

                <button
                    type="submit"
                    class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="form.processing || !form.transcription_id"
                >
                    {{ form.processing ? 'Copying…' : 'Copy' }}
                </button>
            </form>
        </div>
    </div>
</template>
