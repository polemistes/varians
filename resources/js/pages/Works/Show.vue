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
import {
    create as createWitness,
    show as showWitness,
} from '@/routes/witnesses';
import { destroy as destroyWork, update as updateWork } from '@/routes/works';
import type { Auth } from '@/types/auth';
import type { TranscriptionLayer, Witness, Work } from '@/types/models';

const props = defineProps<{
    work: Work;
    transcriptions: TranscriptionLayer[];
    allWitnesses: Witness[];
}>();

const page = usePage<{ auth: Auth }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

const editingDetails = ref(false);
const detailsForm = useForm({
    title: props.work.title,
    author: props.work.author ?? '',
});

function saveDetails() {
    detailsForm.patch(updateWork.url(props.work), {
        preserveScroll: true,
        onSuccess: () => (editingDetails.value = false),
    });
}

function cancelDetails() {
    detailsForm.reset();
    editingDetails.value = false;
}

function removeWork() {
    const parts = describeDeletionImpact(props.work.deletion_impact, [
        {
            key: 'canonicalPassages',
            label: (n) => pluralize(n, 'passage'),
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
</script>

<template>
    <Head :title="props.work.title" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-3xl">
            <AppHeader />

            <div class="mt-2 mb-1 flex items-baseline gap-3">
                <h1 class="font-serif text-2xl font-medium">
                    {{ props.work.title }}
                </h1>
                <button
                    v-if="canEdit && !editingDetails"
                    type="button"
                    class="text-xs text-stone-500 underline dark:text-stone-400"
                    @click="editingDetails = true"
                >
                    Edit title/author
                </button>
            </div>
            <p
                v-if="!editingDetails"
                class="mb-1 text-stone-600 dark:text-stone-400"
            >
                {{ props.work.author }}
            </p>

            <!-- Title and author only: the slug is in the URL of every edition
                 of this work, and the reference scheme is what every passage
                 address was built against. -->
            <form
                v-if="editingDetails"
                class="mb-3 flex flex-wrap items-end gap-2 text-sm"
                @submit.prevent="saveDetails"
            >
                <label class="flex flex-col gap-1">
                    Title
                    <input
                        v-model="detailsForm.title"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>
                <label class="flex flex-col gap-1">
                    Author
                    <input
                        v-model="detailsForm.author"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>
                <button
                    type="submit"
                    class="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="detailsForm.processing || !detailsForm.title"
                >
                    Save
                </button>
                <button
                    type="button"
                    class="text-stone-500 underline dark:text-stone-400"
                    @click="cancelDetails"
                >
                    Cancel
                </button>
                <span
                    v-if="detailsForm.errors.title"
                    class="w-full text-xs text-red-600 dark:text-red-400"
                    >{{ detailsForm.errors.title }}</span
                >
            </form>
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
        </div>
    </div>
</template>
