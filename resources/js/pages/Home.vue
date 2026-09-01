<script setup lang="ts">
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { isEditorOrAbove } from '@/lib/auth';
import { confirmDeletion, pluralize } from '@/lib/deletionImpact';
import {
    create as createEdition,
    destroy as destroyEdition,
    show as showEdition,
} from '@/routes/editions';
import {
    create as createWitness,
    destroy as destroyWitness,
    show as showWitness,
} from '@/routes/witnesses';
import {
    create as createWork,
    destroy as destroyWork,
    show as showWork,
} from '@/routes/works';
import type { Auth } from '@/types/auth';
import type { Witness, Work } from '@/types/models';

type EditionRow = {
    id: number;
    title: string;
    visibility: string;
    work?: Pick<Work, 'id' | 'title' | 'slug'>;
};

type WorkRow = Pick<Work, 'id' | 'title' | 'slug' | 'author'> & {
    editions_count: number;
    canonical_passages_count: number;
};

type WitnessRow = Pick<Witness, 'id' | 'siglum' | 'label' | 'type'> & {
    transcriptions_count: number;
};

const props = defineProps<{
    editions: EditionRow[];
    works: WorkRow[];
    witnesses: WitnessRow[];
}>();

const page = usePage<{ auth: Auth }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

// An edition belongs to a work, so starting one means naming the work first.
// Revealed on demand rather than sitting there as a permanent select.
const choosingWork = ref(false);

function startEdition(slug: string) {
    if (slug) {
        router.get(createEdition.url({ work: slug }));
    }
}

// The itemised preview of what a delete destroys lives on each item's own
// page, where one row's worth of queries is affordable. Here the headline
// counts come from the list itself, so the warning still says what goes.
function removeEdition(edition: EditionRow) {
    if (confirmDeletion(`the edition "${edition.title}"`, [])) {
        router.delete(destroyEdition.url(edition.id));
    }
}

function removeWork(work: WorkRow) {
    const parts = [
        pluralize(work.editions_count, 'edition'),
        pluralize(work.canonical_passages_count, 'canonical passage'),
    ].filter((part) => !part.startsWith('0 '));

    if (confirmDeletion(`the work "${work.title}"`, parts)) {
        router.delete(destroyWork.url(work.slug));
    }
}

function removeWitness(witness: WitnessRow) {
    const parts = [
        pluralize(witness.transcriptions_count, 'transcription'),
    ].filter((part) => !part.startsWith('0 '));

    if (confirmDeletion(`the witness ${witness.siglum}`, parts)) {
        router.delete(destroyWitness.url(witness.id));
    }
}
</script>

<template>
    <Head />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-6xl">
            <AppHeader />

            <header class="mb-10">
                <h1 class="font-serif text-4xl font-medium">Varians</h1>
                <p class="mt-2 text-stone-600 dark:text-stone-400">
                    A platform for making and viewing digital scholarly editions
                    of ancient texts
                </p>
            </header>

            <div class="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <!-- Editions -->
                <section>
                    <div class="mb-3 flex items-baseline justify-between gap-3">
                        <h2 class="font-serif text-xl">Editions</h2>
                        <button
                            v-if="canEdit"
                            type="button"
                            class="text-xs text-stone-500 underline dark:text-stone-400"
                            @click="choosingWork = !choosingWork"
                        >
                            {{ choosingWork ? 'Cancel' : '+ Add' }}
                        </button>
                    </div>

                    <p
                        v-if="choosingWork && props.works.length === 0"
                        class="mb-3 text-xs text-stone-500 dark:text-stone-400"
                    >
                        An edition is of a work, so add a work first.
                    </p>
                    <select
                        v-else-if="choosingWork"
                        class="mb-3 w-full rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                        @change="
                            startEdition(
                                ($event.target as HTMLSelectElement).value,
                            )
                        "
                    >
                        <option value="">Of which work&hellip;</option>
                        <option
                            v-for="work in props.works"
                            :key="work.id"
                            :value="work.slug"
                        >
                            {{ work.title }}
                        </option>
                    </select>

                    <ul class="flex flex-col gap-2">
                        <li
                            v-for="edition in props.editions"
                            :key="edition.id"
                            class="flex items-baseline justify-between gap-2 rounded border border-stone-200 p-3 dark:border-stone-800"
                        >
                            <Link
                                v-if="edition.work"
                                :href="
                                    showEdition.url({
                                        work: edition.work.slug,
                                        edition: edition.id,
                                    })
                                "
                                class="min-w-0 flex-1"
                            >
                                <span class="font-serif">{{
                                    edition.title
                                }}</span>
                                <span
                                    class="block text-xs text-stone-500 dark:text-stone-400"
                                >
                                    {{ edition.work.title
                                    }}<template
                                        v-if="
                                            edition.visibility !== 'published'
                                        "
                                    >
                                        &middot; {{ edition.visibility }}
                                    </template>
                                </span>
                            </Link>
                            <button
                                v-if="canEdit"
                                type="button"
                                class="text-xs text-red-600 underline dark:text-red-400"
                                @click="removeEdition(edition)"
                            >
                                Delete
                            </button>
                        </li>
                        <li
                            v-if="props.editions.length === 0"
                            class="text-sm text-stone-500 dark:text-stone-400"
                        >
                            No editions yet.
                        </li>
                    </ul>
                </section>

                <!-- Works -->
                <section>
                    <div class="mb-3 flex items-baseline justify-between gap-3">
                        <h2 class="font-serif text-xl">Works</h2>
                        <Link
                            v-if="canEdit"
                            :href="createWork.url()"
                            class="text-xs text-stone-500 underline dark:text-stone-400"
                            >+ Add</Link
                        >
                    </div>

                    <ul class="flex flex-col gap-2">
                        <li
                            v-for="work in props.works"
                            :key="work.id"
                            class="flex items-baseline justify-between gap-2 rounded border border-stone-200 p-3 dark:border-stone-800"
                        >
                            <Link
                                :href="showWork.url(work)"
                                class="min-w-0 flex-1"
                            >
                                <span class="font-serif">{{ work.title }}</span>
                                <span
                                    v-if="work.author"
                                    class="block text-xs text-stone-500 dark:text-stone-400"
                                    >{{ work.author }}</span
                                >
                            </Link>
                            <button
                                v-if="canEdit"
                                type="button"
                                class="text-xs text-red-600 underline dark:text-red-400"
                                @click="removeWork(work)"
                            >
                                Delete
                            </button>
                        </li>
                        <li
                            v-if="props.works.length === 0"
                            class="text-sm text-stone-500 dark:text-stone-400"
                        >
                            No works yet.
                        </li>
                    </ul>
                </section>

                <!-- Witnesses -->
                <section>
                    <div class="mb-3 flex items-baseline justify-between gap-3">
                        <h2 class="font-serif text-xl">Witnesses</h2>
                        <Link
                            v-if="canEdit"
                            :href="createWitness.url()"
                            class="text-xs text-stone-500 underline dark:text-stone-400"
                            >+ Add</Link
                        >
                    </div>

                    <ul class="flex flex-col gap-2">
                        <li
                            v-for="witness in props.witnesses"
                            :key="witness.id"
                            class="flex items-baseline justify-between gap-2 rounded border border-stone-200 p-3 dark:border-stone-800"
                        >
                            <Link
                                :href="showWitness.url(witness.id)"
                                class="min-w-0 flex-1"
                            >
                                <span class="font-serif">{{
                                    witness.siglum
                                }}</span>
                                <span
                                    class="block text-xs text-stone-500 dark:text-stone-400"
                                >
                                    {{ witness.label ?? witness.type }}
                                </span>
                            </Link>
                            <button
                                v-if="canEdit"
                                type="button"
                                class="text-xs text-red-600 underline dark:text-red-400"
                                @click="removeWitness(witness)"
                            >
                                Delete
                            </button>
                        </li>
                        <li
                            v-if="props.witnesses.length === 0"
                            class="text-sm text-stone-500 dark:text-stone-400"
                        >
                            No witnesses yet.
                        </li>
                    </ul>
                </section>
            </div>
        </div>
    </div>
</template>
