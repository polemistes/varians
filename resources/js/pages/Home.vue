<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { confirmDeletion, pluralize } from '@/lib/deletionImpact';
import { provenance, recordedAt } from '@/lib/provenance';
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
import type { Witness, Work } from '@/types/models';

// `user` is the owner and `created_at` when the record was made — together
// they are what tells a copy from the thing it was copied from, since the
// name is the same. The owner can be null: the account was deleted.
type Owned = {
    user?: { id: number; name: string } | null;
    created_at: string | null;
    /** Which of the three groups the row belongs in — see HomeController. */
    sharing: Sharing;
};

type Sharing = 'own' | 'shared' | 'public';

const groupLabels: Record<Sharing, string> = {
    own: 'Your own',
    shared: 'Shared with you',
    public: 'Public',
};

type EditionRow = Owned & {
    id: number;
    title: string;
    visibility: string;
    work?: Pick<Work, 'id' | 'title' | 'slug'>;
    can_delete: boolean;
};

type WorkRow = Pick<Work, 'id' | 'title' | 'slug' | 'author'> &
    Owned & {
        editions_count: number;
        transcription_segments_count: number;
        can_edit: boolean;
        can_delete: boolean;
    };

type WitnessRow = Pick<Witness, 'id' | 'siglum' | 'label' | 'date_text'> &
    Owned & {
        transcriptions_count: number;
        can_delete: boolean;
    };

const props = defineProps<{
    can: { create: boolean };
    editions: EditionRow[];
    works: WorkRow[];
    witnesses: WitnessRow[];
}>();

// Every member may start a work, a witness or an edition of her own.
const canEdit = computed(() => props.can.create);

/**
 * Each list under its three headings, in a fixed order, with empty groups
 * left out. A signed-out visitor sees only public material, where a heading
 * saying so would be noise, so the lists stay flat for her.
 */
function grouped<Row extends Owned>(rows: Row[]) {
    const order: Sharing[] = canEdit.value
        ? ['own', 'shared', 'public']
        : ['public'];

    return order
        .map((key) => ({
            key,
            label: groupLabels[key],
            rows: canEdit.value
                ? rows.filter((row) => row.sharing === key)
                : rows,
        }))
        .filter((group) => group.rows.length > 0);
}

const workGroups = computed(() => grouped(props.works));
const witnessGroups = computed(() => grouped(props.witnesses));
const editionGroups = computed(() => grouped(props.editions));

// An edition belongs to a work, so starting one means naming the work first.
// Revealed on demand rather than sitting there as a permanent select.
const choosingWork = ref(false);
// An edition is made on a work one may edit — one's own, or one whose
// editions one has been invited to.
const editableWorks = computed(() =>
    props.works.filter((work) => work.can_edit),
);

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
        pluralize(work.transcription_segments_count, 'passage assignment'),
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

                    <div class="flex flex-col gap-5">
                        <div v-for="group in workGroups" :key="group.key">
                            <h3
                                v-if="canEdit"
                                class="mb-2 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
                            >
                                {{ group.label }}
                            </h3>
                            <ul class="flex flex-col gap-2">
                                <li
                                    v-for="work in group.rows"
                                    :key="work.id"
                                    class="flex items-baseline justify-between gap-2 rounded border border-stone-200 p-3 dark:border-stone-800"
                                >
                                    <Link
                                        :href="showWork.url(work)"
                                        class="min-w-0 flex-1"
                                    >
                                        <span class="font-serif">{{
                                            work.title
                                        }}</span>
                                        <span
                                            v-if="work.author"
                                            class="block text-xs text-stone-500 dark:text-stone-400"
                                            >{{ work.author }}</span
                                        >
                                        <span
                                            class="block text-xs text-stone-400 dark:text-stone-500"
                                            :title="recordedAt(work.created_at)"
                                            >{{
                                                provenance(
                                                    work.user?.name,
                                                    work.created_at,
                                                )
                                            }}</span
                                        >
                                    </Link>
                                    <button
                                        v-if="work.can_delete"
                                        type="button"
                                        class="text-xs text-red-600 underline dark:text-red-400"
                                        @click="removeWork(work)"
                                    >
                                        Delete
                                    </button>
                                </li>
                            </ul>
                        </div>
                        <p
                            v-if="props.works.length === 0"
                            class="text-sm text-stone-500 dark:text-stone-400"
                        >
                            No works yet.
                        </p>
                    </div>
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

                    <div class="flex flex-col gap-5">
                        <div v-for="group in witnessGroups" :key="group.key">
                            <h3
                                v-if="canEdit"
                                class="mb-2 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
                            >
                                {{ group.label }}
                            </h3>
                            <ul class="flex flex-col gap-2">
                                <li
                                    v-for="witness in group.rows"
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
                                            {{
                                                witness.label ??
                                                witness.date_text ??
                                                ''
                                            }}
                                        </span>
                                        <span
                                            class="block text-xs text-stone-400 dark:text-stone-500"
                                            :title="
                                                recordedAt(witness.created_at)
                                            "
                                            >{{
                                                provenance(
                                                    witness.user?.name,
                                                    witness.created_at,
                                                )
                                            }}</span
                                        >
                                    </Link>
                                    <button
                                        v-if="witness.can_delete"
                                        type="button"
                                        class="text-xs text-red-600 underline dark:text-red-400"
                                        @click="removeWitness(witness)"
                                    >
                                        Delete
                                    </button>
                                </li>
                            </ul>
                        </div>
                        <p
                            v-if="props.witnesses.length === 0"
                            class="text-sm text-stone-500 dark:text-stone-400"
                        >
                            No witnesses yet.
                        </p>
                    </div>
                </section>

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
                        v-if="choosingWork && editableWorks.length === 0"
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
                            v-for="work in editableWorks"
                            :key="work.id"
                            :value="work.slug"
                        >
                            {{ work.title }}
                        </option>
                    </select>

                    <div class="flex flex-col gap-5">
                        <div v-for="group in editionGroups" :key="group.key">
                            <h3
                                v-if="canEdit"
                                class="mb-2 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
                            >
                                {{ group.label }}
                            </h3>
                            <ul class="flex flex-col gap-2">
                                <li
                                    v-for="edition in group.rows"
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
                                                    edition.visibility !==
                                                    'published'
                                                "
                                            >
                                                &middot;
                                                {{ edition.visibility }}
                                            </template>
                                        </span>
                                        <span
                                            class="block text-xs text-stone-400 dark:text-stone-500"
                                            :title="
                                                recordedAt(edition.created_at)
                                            "
                                            >{{
                                                provenance(
                                                    edition.user?.name,
                                                    edition.created_at,
                                                )
                                            }}</span
                                        >
                                    </Link>
                                    <button
                                        v-if="edition.can_delete"
                                        type="button"
                                        class="text-xs text-red-600 underline dark:text-red-400"
                                        @click="removeEdition(edition)"
                                    >
                                        Delete
                                    </button>
                                </li>
                            </ul>
                        </div>
                        <p
                            v-if="props.editions.length === 0"
                            class="text-sm text-stone-500 dark:text-stone-400"
                        >
                            No editions yet.
                        </p>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>
