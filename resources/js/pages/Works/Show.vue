<script setup lang="ts">
import { Head, Link, router, useForm } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import ConjectureForm from '@/components/ConjectureForm.vue';
import type { BiblatexRegistry, Suggestions } from '@/lib/biblatex';
import {
    confirmDeletion,
    describeDeletionImpact,
    pluralize,
} from '@/lib/deletionImpact';
import { destroy as destroyConjecture } from '@/routes/conjectures';
import {
    create as createEdition,
    show as showEdition,
} from '@/routes/editions';
import {
    create as createWitness,
    show as showWitness,
} from '@/routes/witnesses';
import { destroy as destroyWork, update as updateWork } from '@/routes/works';
import type { WorkConjecture, WorkPassage } from '@/types/conjectures';
import type {
    ReferenceLevel,
    TranscriptionLayer,
    Witness,
    Work,
} from '@/types/models';

const props = defineProps<{
    work: Work;
    can: { edit: boolean; delete: boolean; createEdition: boolean };
    transcriptions: TranscriptionLayer[];
    conjectures: WorkConjecture[];
    referenceLevels: ReferenceLevel[];
    bibliographyForm: { registry: BiblatexRegistry; suggestions: Suggestions };
}>();

// ---- the work's conjectures: recorded, edited and removed here, whatever
// their kind; an edition places or follows them from its own page. ----
const passagesForForm = computed<WorkPassage[]>(() =>
    (props.work.canonical_passages ?? []).map((passage) => ({
        id: passage.id,
        address: passage.address,
        label: passage.label,
        sort_key: passage.sort_key,
    })),
);

const lacunas = computed(() =>
    props.conjectures
        .filter((conjecture) => conjecture.type === 'lacuna')
        .map((conjecture) => ({
            id: conjecture.id,
            canonical_passage_id: conjecture.canonical_passage_id,
            label: `${conjecture.passage_label} — ${conjecture.proposed_by ?? conjecture.entered_by}${conjecture.extent ? ` (${conjecture.extent})` : ''}`,
        })),
);

const addingConjecture = ref(false);
const editingConjectureId = ref<number | null>(null);

// Full words, never abbreviations — space is not scarce in a digital
// edition (user decision).
const TYPE_LABELS: Record<WorkConjecture['type'], string> = {
    substitution: 'conjecture',
    deletion: 'deletion',
    lacuna: 'lacuna',
    supplement: 'supplement',
    transposition: 'transposition',
    reordering: 'reordering',
};

/** What the conjecture proposes, in one line. */
function statement(conjecture: WorkConjecture): string {
    switch (conjecture.type) {
        case 'substitution':
            return conjecture.text ?? '';
        case 'deletion':
            return 'the words are deleted';
        case 'supplement':
            return `${conjecture.text ?? ''} — fills the lacuna ${conjecture.supplements_label ?? ''}`;
        case 'lacuna':
            return conjecture.extent
                ? `lacuna: ${conjecture.extent}`
                : 'lacuna';
        case 'transposition':
            return `${conjecture.passage_label}${conjecture.range_end_label ? `–${conjecture.range_end_label}` : ''} moves ${conjecture.move_position} ${conjecture.target_label}`;
        case 'reordering':
            return conjecture.ordering.map((entry) => entry.label).join(' ');
    }
}

function usage(conjecture: WorkConjecture): string[] {
    const parts: string[] = [];

    if (conjecture.selected_by.length > 0) {
        parts.push(`in the text of ${conjecture.selected_by.join(', ')}`);
    } else if (conjecture.placed) {
        parts.push('placed in the apparatus');
    }

    if (conjecture.adopted_by.length > 0) {
        parts.push(`adopted by ${conjecture.adopted_by.join(', ')}`);
    }

    return parts;
}

function removeConjecture(conjecture: WorkConjecture) {
    const parts = describeDeletionImpact(conjecture.deletion_impact, [
        {
            key: 'readings',
            label: (n) => pluralize(n, 'placement in the apparatus'),
        },
        {
            key: 'editionSelections',
            label: (n) => pluralize(n, 'edition selection that prints it'),
        },
        {
            key: 'adoptions',
            label: (n) => pluralize(n, 'edition following it'),
        },
        {
            key: 'supplements',
            label: (n) => pluralize(n, 'supplement that fills it'),
        },
        { key: 'citations', label: (n) => pluralize(n, 'citation') },
    ]);

    if (
        !confirmDeletion(
            `the ${TYPE_LABELS[conjecture.type]} ${conjecture.proposed_by ?? conjecture.entered_by} on ${conjecture.passage_label}`,
            parts,
        )
    ) {
        return;
    }

    router.delete(destroyConjecture.url(conjecture.id), {
        preserveScroll: true,
    });
}

// What the server's policies allow this viewer — the page only reflects it.
const canEdit = computed(() => props.can.edit);

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
    // Assignments first, and passages not at all: a passage is a citable line
    // number, cheap to recreate, while assigning some witness's words to it is
    // the work. A hundred lines across seven manuscripts is seven hundred
    // assignments and only a hundred passages, and the second number is the
    // one that sounds harmless.
    const parts = describeDeletionImpact(props.work.deletion_impact, [
        {
            key: 'segments',
            label: (n) => pluralize(n, 'passage assignment on a witness'),
        },
        { key: 'editions', label: (n) => pluralize(n, 'edition of this work') },
        { key: 'conjectures', label: (n) => pluralize(n, 'conjecture') },
        { key: 'lemmas', label: (n) => pluralize(n, 'lemma') },
    ]);

    if (!confirmDeletion(`${props.work.title}`, parts)) {
        return;
    }

    router.delete(destroyWork.url(props.work));
}

function manuscriptSummary(witness: Witness): string | null {
    const location = [witness.repository, witness.shelfmark]
        .filter(Boolean)
        .join(', ');
    const date = witness.date_text ? `(${witness.date_text})` : '';

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
                    v-if="props.can.delete"
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
                        v-if="props.can.createEdition"
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
                                v-if="witness.date_text"
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >({{ witness.date_text }})</span
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

            <!-- Every conjecture recorded against this work, of whatever
                 kind: the stockpile any edition of the work draws on. -->
            <section class="mb-10">
                <div class="mb-3 flex items-center justify-between">
                    <h2 class="font-serif text-lg">Conjectures</h2>
                    <button
                        v-if="canEdit"
                        type="button"
                        class="text-xs text-stone-600 underline dark:text-stone-400"
                        @click="
                            addingConjecture = !addingConjecture;
                            editingConjectureId = null;
                        "
                    >
                        {{ addingConjecture ? 'Cancel' : '+ New conjecture' }}
                    </button>
                </div>
                <p
                    v-if="canEdit"
                    class="mb-3 text-xs text-stone-500 dark:text-stone-400"
                >
                    Recorded here as proposals; an edition places a reading or
                    follows an order from its own page.
                </p>

                <ConjectureForm
                    v-if="addingConjecture"
                    class="mb-3"
                    :passages="passagesForForm"
                    :levels="props.referenceLevels"
                    :lacunas="lacunas"
                    :registry="props.bibliographyForm.registry"
                    :suggestions="props.bibliographyForm.suggestions"
                    @saved="addingConjecture = false"
                    @cancel="addingConjecture = false"
                />

                <ul class="flex flex-col gap-3">
                    <li
                        v-for="conjecture in props.conjectures"
                        :key="conjecture.id"
                        class="rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-800"
                    >
                        <div class="flex items-baseline justify-between gap-4">
                            <span>
                                <span
                                    class="mr-2 rounded bg-stone-200 px-1.5 py-0.5 font-sans text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                                    >{{ conjecture.passage_label }}</span
                                >
                                <span
                                    class="text-xs text-stone-500 dark:text-stone-400"
                                    >{{ TYPE_LABELS[conjecture.type] }}
                                    {{
                                        conjecture.proposed_by ??
                                        conjecture.entered_by
                                    }}</span
                                >
                                <span
                                    class="ml-2"
                                    :class="
                                        conjecture.type === 'substitution' ||
                                        conjecture.type === 'supplement'
                                            ? 'font-serif'
                                            : ''
                                    "
                                    >{{ statement(conjecture) }}</span
                                >
                            </span>
                            <span
                                v-if="canEdit"
                                class="flex shrink-0 gap-2 text-xs"
                            >
                                <button
                                    type="button"
                                    class="underline"
                                    @click="
                                        editingConjectureId =
                                            editingConjectureId ===
                                            conjecture.id
                                                ? null
                                                : conjecture.id;
                                        addingConjecture = false;
                                    "
                                >
                                    {{
                                        editingConjectureId === conjecture.id
                                            ? 'Close'
                                            : 'Edit'
                                    }}
                                </button>
                                <button
                                    type="button"
                                    class="text-red-600 underline dark:text-red-400"
                                    @click="removeConjecture(conjecture)"
                                >
                                    Delete
                                </button>
                            </span>
                        </div>
                        <p
                            v-if="
                                conjecture.references.length > 0 ||
                                conjecture.note ||
                                usage(conjecture).length > 0
                            "
                            class="mt-1 text-xs text-stone-500 dark:text-stone-400"
                        >
                            <template v-if="conjecture.references.length > 0"
                                >({{
                                    conjecture.references
                                        .map((reference) => reference.citation)
                                        .join('; ')
                                }})
                            </template>
                            <em v-if="conjecture.note"
                                >{{ conjecture.note }}
                            </em>
                            <span v-if="usage(conjecture).length > 0"
                                ><template
                                    v-if="
                                        conjecture.references.length > 0 ||
                                        conjecture.note
                                    "
                                    >&middot; </template
                                >{{ usage(conjecture).join('; ') }}</span
                            >
                        </p>

                        <ConjectureForm
                            v-if="editingConjectureId === conjecture.id"
                            class="mt-3"
                            :passages="passagesForForm"
                            :levels="props.referenceLevels"
                            :lacunas="lacunas"
                            :conjecture="conjecture"
                            :registry="props.bibliographyForm.registry"
                            :suggestions="props.bibliographyForm.suggestions"
                            @saved="editingConjectureId = null"
                            @cancel="editingConjectureId = null"
                        />
                    </li>
                    <li
                        v-if="props.conjectures.length === 0"
                        class="text-sm text-stone-500 dark:text-stone-400"
                    >
                        No conjectures recorded for this work yet.
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>
