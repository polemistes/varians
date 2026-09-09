<script setup lang="ts">
import { Head, router, useForm, usePage } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import BibliographyItemForm from '@/components/BibliographyItemForm.vue';
import { isEditorOrAbove } from '@/lib/auth';
import type { BiblatexRegistry, Suggestions } from '@/lib/biblatex';
import { confirmDeletion } from '@/lib/deletionImpact';
import {
    destroy as destroyItem,
    exportMethod as exportBibliography,
    importMethod as importBibliography,
    index as bibliographyIndex,
} from '@/routes/bibliography';
import type { Auth } from '@/types/auth';

type ReferenceRun = { text: string; italic: boolean };

type Item = {
    id: number;
    entry_type: string;
    citation_key: string;
    label: string;
    fields: Record<string, string>;
    reference: ReferenceRun[];
    references_count: number;
    biblatex: string;
};

const props = defineProps<{
    items: Item[];
    search: string;
    registry: BiblatexRegistry;
    suggestions: Suggestions;
}>();

const page = usePage<{
    auth: Auth;
    errors?: Record<string, string>;
    flash?: { message?: string | null };
}>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

// Search is a visit, so a bookmark reproduces it.
const search = ref(props.search);

function runSearch() {
    router.get(
        bibliographyIndex.url({ query: { q: search.value || undefined } }),
        {},
        { preserveState: true, preserveScroll: true, replace: true },
    );
}

const adding = ref(false);
const editingId = ref<number | null>(null);

function startEditing(item: Item) {
    editingId.value = editingId.value === item.id ? null : item.id;
    adding.value = false;
}

function removeItem(item: Item) {
    if (!confirmDeletion(`“${item.label}” from the bibliography`, [])) {
        return;
    }

    router.delete(destroyItem.url(item.id), { preserveScroll: true });
}

const deleteError = computed(() => page.props.errors?.item ?? null);

// ---- import: a .bib file, pasted or uploaded ----
const importing = ref(false);
const importForm = useForm<{
    bibtex: string;
    file: File | null;
    replace: boolean;
}>({
    bibtex: '',
    file: null,
    replace: false,
});

function onImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    importForm.file = input.files?.[0] ?? null;
}

function submitImport() {
    importForm.post(importBibliography.url(), {
        preserveScroll: true,
        forceFormData: true,
        onSuccess: () => {
            importForm.reset();
            importing.value = false;
        },
    });
}

/** The import's report, or any other one-shot notice. */
const notice = computed(() => page.props.flash?.message ?? null);
</script>

<template>
    <Head title="Bibliography" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-4xl">
            <AppHeader />

            <div
                class="mt-2 mb-1 flex flex-wrap items-baseline justify-between gap-3"
            >
                <h1 class="font-serif text-2xl font-medium">Bibliography</h1>
                <div class="flex items-center gap-3 text-xs">
                    <a
                        :href="exportBibliography.url()"
                        class="text-stone-500 underline dark:text-stone-400"
                        >Download as .bib</a
                    >
                    <button
                        v-if="canEdit"
                        type="button"
                        class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                        @click="
                            importing = !importing;
                            adding = false;
                        "
                    >
                        {{ importing ? 'Cancel import' : 'Import .bib' }}
                    </button>
                    <button
                        v-if="canEdit"
                        type="button"
                        class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                        @click="
                            adding = !adding;
                            importing = false;
                            editingId = null;
                        "
                    >
                        {{ adding ? 'Cancel' : '+ New item' }}
                    </button>
                </div>
            </div>
            <p class="mb-4 text-sm text-stone-600 dark:text-stone-400">
                The common list every conjecture and every edition cites from,
                kept in biblatex's own terms.
            </p>

            <p
                v-if="notice"
                class="mb-3 rounded border border-sky-300 px-2 py-1 text-xs text-sky-800 dark:border-sky-800 dark:text-sky-300"
            >
                {{ notice }}
            </p>

            <!-- Import: entries become items; a key already in the list is
                 skipped unless the editor asks to replace. -->
            <form
                v-if="importing"
                class="mb-4 flex flex-col gap-2 rounded border border-stone-200 bg-stone-50 p-3 text-xs dark:border-stone-800 dark:bg-stone-900/50"
                @submit.prevent="submitImport"
            >
                <label class="flex flex-col gap-0.5">
                    Paste biblatex entries
                    <textarea
                        v-model="importForm.bibtex"
                        rows="6"
                        placeholder="@book{dover1972,&#10;  author = {Dover, K. J.},&#10;  title = {Aristophanic Comedy},&#10;  date = {1972}&#10;}"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 font-mono dark:border-stone-700"
                    ></textarea>
                </label>
                <label class="flex flex-wrap items-center gap-2">
                    or choose a file
                    <input
                        type="file"
                        accept=".bib,text/plain"
                        @change="onImportFile"
                    />
                </label>
                <label class="flex items-center gap-1">
                    <input v-model="importForm.replace" type="checkbox" />
                    Replace items whose citation key is already in the list
                </label>
                <span
                    v-if="importForm.errors.bibtex || importForm.errors.file"
                    class="text-red-600 dark:text-red-400"
                    >{{
                        importForm.errors.bibtex ?? importForm.errors.file
                    }}</span
                >
                <div class="flex items-center gap-2">
                    <button
                        type="submit"
                        class="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        :disabled="importForm.processing"
                    >
                        Import
                    </button>
                    <button
                        type="button"
                        class="text-stone-500 underline dark:text-stone-400"
                        @click="importing = false"
                    >
                        Cancel
                    </button>
                </div>
            </form>

            <BibliographyItemForm
                v-if="adding"
                class="mb-4"
                :registry="props.registry"
                :suggestions="props.suggestions"
                @saved="adding = false"
                @cancel="adding = false"
            />

            <form
                class="mb-4 flex items-center gap-2 text-sm"
                @submit.prevent="runSearch"
            >
                <input
                    v-model="search"
                    type="search"
                    placeholder="Search by author, title, year or key"
                    class="w-full rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                />
                <button
                    type="submit"
                    class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                >
                    Search
                </button>
            </form>

            <p
                v-if="deleteError"
                class="mb-3 rounded border border-red-300 px-2 py-1 text-xs text-red-700 dark:border-red-800 dark:text-red-400"
            >
                {{ deleteError }}
            </p>

            <ul class="flex flex-col gap-2">
                <li
                    v-for="item in props.items"
                    :id="`bibliography-${item.id}`"
                    :key="item.id"
                    class="rounded border border-stone-200 p-3 text-sm dark:border-stone-800"
                >
                    <div class="flex items-baseline justify-between gap-3">
                        <span class="font-medium">{{ item.label }}</span>
                        <span class="flex shrink-0 items-center gap-2 text-xs">
                            <span
                                class="font-mono text-stone-400 dark:text-stone-600"
                                >@{{ item.entry_type }}{{ '{'
                                }}{{ item.citation_key }}{{ '}' }}</span
                            >
                            <span
                                class="text-stone-500 dark:text-stone-400"
                                :title="
                                    item.references_count === 0
                                        ? 'Nothing cites this item yet'
                                        : 'Cited this many times'
                                "
                                >{{ item.references_count }}
                                {{
                                    item.references_count === 1
                                        ? 'citation'
                                        : 'citations'
                                }}</span
                            >
                            <button
                                v-if="canEdit"
                                type="button"
                                class="underline"
                                @click="startEditing(item)"
                            >
                                {{ editingId === item.id ? 'Close' : 'Edit' }}
                            </button>
                            <button
                                v-if="canEdit && item.references_count === 0"
                                type="button"
                                class="text-red-600 underline dark:text-red-400"
                                @click="removeItem(item)"
                            >
                                Delete
                            </button>
                        </span>
                    </div>
                    <p class="mt-1 text-stone-700 dark:text-stone-300">
                        <template
                            v-for="(run, index) in item.reference"
                            :key="index"
                        >
                            <em v-if="run.italic">{{ run.text }}</em>
                            <template v-else>{{ run.text }}</template>
                        </template>
                    </p>

                    <BibliographyItemForm
                        v-if="editingId === item.id"
                        class="mt-3"
                        :registry="props.registry"
                        :suggestions="props.suggestions"
                        :item="item"
                        @saved="editingId = null"
                        @cancel="editingId = null"
                    />
                </li>
                <li
                    v-if="props.items.length === 0"
                    class="text-sm text-stone-500 dark:text-stone-400"
                >
                    <template v-if="props.search"
                        >Nothing matches “{{ props.search }}”.</template
                    >
                    <template v-else>No bibliographic items yet.</template>
                </li>
            </ul>
        </div>
    </div>
</template>
