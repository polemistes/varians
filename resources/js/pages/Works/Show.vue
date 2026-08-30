<script setup lang="ts">
import { Head, Link, router, useForm, usePage } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { isEditorOrAbove } from '@/lib/auth';
import {
    confirmDeletion,
    describeDeletionImpact,
    pluralize,
} from '@/lib/deletionImpact';
import {
    create as createEdition,
    show as showEdition,
} from '@/routes/editions';
import { store as storeTextImport } from '@/routes/text-imports';
import { show as showTranscription } from '@/routes/transcriptions';
import { create as createFork } from '@/routes/transcriptions/fork';
import {
    create as createWitness,
    show as showWitness,
} from '@/routes/witnesses';
import { destroy as destroyWork, index as worksIndex } from '@/routes/works';
import type { Auth } from '@/types/auth';
import type { Transcription, Witness, Work } from '@/types/models';

const props = defineProps<{
    work: Work;
    transcriptions: Transcription[];
    allWitnesses: Witness[];
}>();

const page = usePage<{ auth: Auth }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

function removeWork() {
    const parts = describeDeletionImpact(props.work.deletion_impact, [
        {
            key: 'canonicalPassages',
            label: (n) => pluralize(n, 'canonical passage'),
        },
        { key: 'editions', label: (n) => pluralize(n, 'edition of this work') },
        {
            key: 'segments',
            label: (n) => pluralize(n, 'citation on a witness’ transcription'),
        },
        { key: 'conjectures', label: (n) => pluralize(n, 'conjecture') },
        { key: 'lemmas', label: (n) => pluralize(n, 'lemma') },
    ]);

    if (!confirmDeletion(`${props.work.title}`, parts)) {
        return;
    }

    router.delete(destroyWork.url(props.work));
}

function manuscriptSummary(witness: Witness): string | null {
    const manuscript = witness.manuscript;

    if (!manuscript) {
        return null;
    }

    const location = [manuscript.repository, manuscript.shelfmark]
        .filter(Boolean)
        .join(', ');
    const date = manuscript.date_text ? `(${manuscript.date_text})` : '';

    return [location, date].filter(Boolean).join(' ') || null;
}

const showImportForm = ref(false);

const importForm = useForm<{
    witness_id: number | '';
    file: File | null;
}>({
    witness_id: '',
    file: null,
});

function onImportFileChange(event: Event) {
    importForm.file = (event.target as HTMLInputElement).files?.[0] ?? null;
}

function submitImport() {
    importForm.post(storeTextImport.url(props.work));
}
</script>

<template>
    <Head :title="props.work.title" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-3xl">
            <AppHeader />

            <Link
                :href="worksIndex.url()"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; Works
            </Link>

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">
                {{ props.work.title }}
            </h1>
            <p class="mb-1 text-stone-600 dark:text-stone-400">
                {{ props.work.author }}
            </p>
            <div class="mb-8 flex items-center justify-between gap-4">
                <p class="text-xs text-stone-500 dark:text-stone-500">
                    {{ props.work.language }} ·
                    {{ props.work.reference_scheme?.name }} ·
                    {{ props.work.canonical_passages?.length ?? 0 }} passages
                </p>
                <button
                    v-if="canEdit"
                    type="button"
                    class="text-xs text-red-600 underline dark:text-red-400"
                    @click="removeWork"
                >
                    Delete work
                </button>
            </div>

            <section class="mb-10">
                <div class="mb-3 flex items-center justify-between">
                    <h2 class="font-serif text-lg">Editions</h2>
                    <Link
                        v-if="canEdit"
                        :href="createEdition.url(props.work)"
                        class="text-xs text-stone-600 underline dark:text-stone-400"
                    >
                        + New edition
                    </Link>
                </div>

                <ul class="flex flex-col gap-3">
                    <li
                        v-for="edition in props.work.editions"
                        :key="edition.id"
                        class="rounded-lg border border-stone-200 p-4 dark:border-stone-800"
                    >
                        <Link
                            :href="showEdition.url([props.work, edition])"
                            class="flex items-baseline justify-between gap-4 hover:opacity-80"
                        >
                            <span class="font-serif">{{ edition.title }}</span>
                            <span
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >{{ edition.visibility }}</span
                            >
                        </Link>
                        <div
                            v-if="edition.description"
                            class="mt-1 text-sm text-stone-600 dark:text-stone-400"
                        >
                            {{ edition.description }}
                        </div>
                    </li>
                    <li
                        v-if="!props.work.editions?.length"
                        class="text-sm text-stone-500 dark:text-stone-400"
                    >
                        No edition has been started for this work yet.
                    </li>
                </ul>
            </section>

            <section class="mb-10">
                <div class="mb-3 flex items-center justify-between">
                    <h2 class="font-serif text-lg">Witnesses</h2>
                    <Link
                        v-if="canEdit"
                        :href="createWitness.url()"
                        class="text-xs text-stone-600 underline dark:text-stone-400"
                    >
                        + Register witness
                    </Link>
                </div>
                <p
                    v-if="canEdit"
                    class="mb-3 text-xs text-stone-500 dark:text-stone-400"
                >
                    A witness becomes connected to this work once one of its
                    transcriptions has a segment citing it — there's no separate
                    step to attach one.
                </p>

                <ul class="flex flex-col gap-3">
                    <li
                        v-for="witness in props.work.witnesses"
                        :key="witness.id"
                        class="rounded-lg border border-stone-200 p-4 dark:border-stone-800"
                    >
                        <Link
                            :href="showWitness.url(witness.id)"
                            class="flex items-baseline justify-between gap-4 hover:opacity-80"
                        >
                            <span class="font-serif"
                                >{{ witness.siglum }} &mdash;
                                {{ witness.label }}</span
                            >
                            <span
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >{{ witness.type }}</span
                            >
                        </Link>
                        <div
                            v-if="manuscriptSummary(witness)"
                            class="mt-1 text-sm text-stone-600 dark:text-stone-400"
                        >
                            {{ manuscriptSummary(witness) }}
                        </div>
                    </li>
                    <li
                        v-if="!props.work.witnesses?.length"
                        class="text-sm text-stone-500 dark:text-stone-400"
                    >
                        No witness has any text assigned to this work yet.
                    </li>
                </ul>
            </section>

            <section v-if="canEdit" class="mb-10">
                <div class="mb-3 flex items-center justify-between">
                    <h2 class="font-serif text-lg">Import a text</h2>
                    <button
                        type="button"
                        class="text-xs text-stone-600 underline dark:text-stone-400"
                        @click="showImportForm = !showImportForm"
                    >
                        {{ showImportForm ? 'Cancel' : '+ Import text' }}
                    </button>
                </div>

                <form
                    v-if="showImportForm"
                    class="flex flex-col gap-2 rounded-lg border border-dashed border-stone-300 p-3 text-sm dark:border-stone-700"
                    @submit.prevent="submitImport"
                >
                    <p class="text-xs text-stone-500 dark:text-stone-400">
                        The file's contents become a transcription of the
                        witness you choose below, exactly as uploaded —
                        <Link :href="createWitness.url()" class="underline">
                            register a new witness first
                        </Link>
                        if the one you need isn't listed yet. Citations and
                        image alignment are added afterward, in the
                        transcription editor.
                    </p>
                    <div class="flex flex-wrap gap-2">
                        <select
                            v-model="importForm.witness_id"
                            class="flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        >
                            <option value="" disabled>
                                Choose a witness&hellip;
                            </option>
                            <option
                                v-for="witness in allWitnesses"
                                :key="witness.id"
                                :value="witness.id"
                            >
                                {{ witness.siglum }} &mdash; {{ witness.label }}
                            </option>
                        </select>
                        <input
                            type="file"
                            accept=".txt,text/plain"
                            class="text-xs"
                            @change="onImportFileChange"
                        />
                    </div>
                    <span
                        v-if="importForm.errors.file"
                        class="text-xs text-red-600 dark:text-red-400"
                    >
                        {{ importForm.errors.file }}
                    </span>
                    <span
                        v-if="importForm.errors.witness_id"
                        class="text-xs text-red-600 dark:text-red-400"
                    >
                        {{ importForm.errors.witness_id }}
                    </span>
                    <button
                        type="submit"
                        class="self-start rounded bg-stone-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        :disabled="
                            importForm.processing ||
                            !importForm.witness_id ||
                            !importForm.file
                        "
                    >
                        {{
                            importForm.processing ? 'Importing…' : 'Import text'
                        }}
                    </button>
                </form>
            </section>

            <section>
                <h2 class="mb-3 font-serif text-lg">Transcriptions</h2>
                <p
                    v-if="props.transcriptions.length === 0"
                    class="text-sm text-stone-500 dark:text-stone-400"
                >
                    No transcription has any text assigned to this work yet.
                </p>
                <ul class="flex flex-col gap-3">
                    <li
                        v-for="transcription in props.transcriptions"
                        :key="transcription.id"
                        class="rounded-lg border border-stone-200 p-4 dark:border-stone-800"
                    >
                        <Link
                            :href="showTranscription.url(transcription.id)"
                            class="block hover:opacity-80"
                        >
                            <div
                                class="flex items-baseline justify-between gap-4"
                            >
                                <span
                                    class="flex flex-wrap items-baseline gap-1"
                                >
                                    {{ transcription.witness?.siglum }}
                                    <span
                                        v-for="tag in transcription.tags"
                                        :key="tag.id"
                                        class="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                                        >{{ tag.name }}</span
                                    >
                                </span>
                                <span
                                    class="text-xs text-stone-500 dark:text-stone-400"
                                    >{{ transcription.visibility }}</span
                                >
                            </div>
                            <div
                                class="mt-1 text-xs text-stone-500 dark:text-stone-400"
                            >
                                by {{ transcription.user?.name }}
                            </div>
                        </Link>
                        <Link
                            v-if="canEdit"
                            :href="createFork.url(transcription.id)"
                            class="mt-2 inline-block text-xs text-stone-500 underline dark:text-stone-400"
                        >
                            Fork &rarr;
                        </Link>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>
