<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
import BibliographyItemForm from '@/components/BibliographyItemForm.vue';
import type { BiblatexRegistry, Suggestions } from '@/lib/biblatex';
import {
    index as bibliographyIndex,
    search as searchBibliography,
} from '@/routes/bibliography';
import {
    destroy as destroyReference,
    store as storeReference,
    update as updateReference,
} from '@/routes/bibliography-references';
import type { Citation, DraftReference } from '@/types/edition';

/**
 * The one way anything cites the common bibliography: a row of citation
 * chips, each with an editable locator and a remove button; a typeahead
 * over the list; and "+ New item…", which opens the item form right here
 * and attaches what it creates. Two modes, decided by which prop is given:
 *
 * - DRAFT (`modelValue`): the citations of something not yet recorded —
 *   a conjecture or order proposal being authored — held locally and sent
 *   in that thing's own request, so it is never created uncited.
 * - LIVE (`target`): the citations of something that exists, saved at
 *   once through bibliography-references, as notes are.
 *
 * The inline item form posts through Inertia and the page reloads; the
 * item it made comes back in `flash.created_bibliography_item`, and only
 * the picker that opened the form attaches it.
 */
type Target =
    | { conjecture_id: number }
    | { edition_id: number; canonical_passage_id: number };

const props = defineProps<{
    modelValue?: DraftReference[];
    target?: Target;
    references?: Citation[];
    registry: BiblatexRegistry;
    suggestions: Suggestions;
    /** Read-only rendering: the citations, and nothing to press. */
    readonly?: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: DraftReference[]): void;
}>();

const page = usePage<{
    flash?: {
        created_bibliography_item?: { id: number; label: string } | null;
    };
}>();

const live = computed(() => props.target !== undefined);

// ---- typeahead ----
const query = ref('');
const results = ref<{ id: number; label: string; reference: string }[]>([]);
const searching = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onQueryInput() {
    if (searchTimer !== null) {
        clearTimeout(searchTimer);
    }

    const term = query.value.trim();

    if (term === '') {
        results.value = [];

        return;
    }

    searchTimer = setTimeout(() => void runSearch(term), 200);
}

async function runSearch(term: string) {
    searching.value = true;

    try {
        const response = await fetch(
            searchBibliography.url({ query: { q: term } }),
            {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            },
        );

        if (response.ok && query.value.trim() === term) {
            results.value = (await response.json()) as typeof results.value;
        }
    } finally {
        searching.value = false;
    }
}

const citedItemIds = computed(
    () =>
        new Set(
            live.value
                ? (props.references ?? []).map((reference) => reference.item_id)
                : (props.modelValue ?? []).map(
                      (reference) => reference.item_id,
                  ),
        ),
);

function attach(item: { id: number; label: string }) {
    query.value = '';
    results.value = [];

    if (citedItemIds.value.has(item.id)) {
        return;
    }

    if (live.value) {
        router.post(
            storeReference.url(),
            { bibliography_item_id: item.id, ...props.target },
            { preserveScroll: true },
        );

        return;
    }

    emit('update:modelValue', [
        ...(props.modelValue ?? []),
        { item_id: item.id, label: item.label, prenote: '', postnote: '' },
    ]);
}

// ---- chips ----
function removeLive(reference: Citation) {
    router.delete(destroyReference.url(reference.id), { preserveScroll: true });
}

function removeDraft(index: number) {
    emit(
        'update:modelValue',
        (props.modelValue ?? []).filter((_, i) => i !== index),
    );
}

function updateDraft(index: number, patch: Partial<DraftReference>) {
    emit(
        'update:modelValue',
        (props.modelValue ?? []).map((reference, i) =>
            i === index ? { ...reference, ...patch } : reference,
        ),
    );
}

// A live locator saves when the field is left, not on every keystroke.
const liveDrafts = ref<Record<number, { prenote: string; postnote: string }>>(
    {},
);

function liveDraft(reference: Citation) {
    liveDrafts.value[reference.id] ??= {
        prenote: reference.prenote ?? '',
        postnote: reference.postnote ?? '',
    };

    return liveDrafts.value[reference.id];
}

function saveLive(reference: Citation) {
    const draft = liveDraft(reference);

    if (
        draft.prenote === (reference.prenote ?? '') &&
        draft.postnote === (reference.postnote ?? '')
    ) {
        return;
    }

    router.patch(
        updateReference.url(reference.id),
        { prenote: draft.prenote || null, postnote: draft.postnote || null },
        { preserveScroll: true },
    );
}

// ---- new item, inline ----
const creating = ref(false);
const awaitingCreated = ref(false);

function openCreate() {
    creating.value = true;
    awaitingCreated.value = true;
}

function closeCreate() {
    creating.value = false;
    awaitingCreated.value = false;
}

watch(
    () => page.props.flash?.created_bibliography_item,
    (created) => {
        if (!created || !awaitingCreated.value) {
            return;
        }

        awaitingCreated.value = false;
        creating.value = false;
        attach(created);
    },
);

const shown = computed<{ key: string; citation: string }[]>(() =>
    live.value
        ? (props.references ?? []).map((reference) => ({
              key: `live-${reference.id}`,
              citation: reference.citation,
          }))
        : (props.modelValue ?? []).map((reference, index) => ({
              key: `draft-${index}`,
              citation: [
                  reference.prenote,
                  reference.label +
                      (reference.postnote ? `, ${reference.postnote}` : ''),
              ]
                  .filter((part) => part)
                  .join(' '),
          })),
);
</script>

<template>
    <div class="flex flex-col gap-1 text-xs">
        <!-- Readers: the citations, plain. -->
        <p v-if="props.readonly" class="text-stone-600 dark:text-stone-400">
            <template v-for="(entry, index) in shown" :key="entry.key"
                ><template v-if="index > 0">; </template
                >{{ entry.citation }}</template
            >
        </p>

        <template v-else>
            <ul v-if="shown.length > 0" class="flex flex-col gap-1">
                <!-- LIVE chips: locator saved on blur, remove at once. -->
                <template v-if="live">
                    <li
                        v-for="reference in props.references ?? []"
                        :key="reference.id"
                        class="flex flex-wrap items-center gap-1"
                    >
                        <input
                            v-model="liveDraft(reference).prenote"
                            type="text"
                            placeholder="cf."
                            title="Before the citation, e.g. cf."
                            class="w-12 rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                            @blur="saveLive(reference)"
                        />
                        <a
                            :href="`${bibliographyIndex.url()}#bibliography-${reference.item_id}`"
                            class="font-medium underline decoration-stone-300 dark:decoration-stone-700"
                            >{{ reference.label }}</a
                        >
                        <input
                            v-model="liveDraft(reference).postnote"
                            type="text"
                            placeholder="pp. 45–47"
                            title="Where in the work, e.g. pp. 45–47 or ad loc."
                            class="w-28 rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                            @blur="saveLive(reference)"
                        />
                        <button
                            type="button"
                            class="px-1 text-stone-400 hover:text-red-600 dark:text-stone-600"
                            title="Remove this citation"
                            @click="removeLive(reference)"
                        >
                            ×
                        </button>
                    </li>
                </template>
                <!-- DRAFT chips: held locally until the form submits. -->
                <template v-else>
                    <li
                        v-for="(reference, index) in props.modelValue ?? []"
                        :key="`${reference.item_id}-${index}`"
                        class="flex flex-wrap items-center gap-1"
                    >
                        <input
                            :value="reference.prenote"
                            type="text"
                            placeholder="cf."
                            title="Before the citation, e.g. cf."
                            class="w-12 rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                            @input="
                                updateDraft(index, {
                                    prenote: ($event.target as HTMLInputElement)
                                        .value,
                                })
                            "
                        />
                        <span class="font-medium">{{ reference.label }}</span>
                        <input
                            :value="reference.postnote"
                            type="text"
                            placeholder="pp. 45–47"
                            title="Where in the work, e.g. pp. 45–47 or ad loc."
                            class="w-28 rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                            @input="
                                updateDraft(index, {
                                    postnote: (
                                        $event.target as HTMLInputElement
                                    ).value,
                                })
                            "
                        />
                        <button
                            type="button"
                            class="px-1 text-stone-400 hover:text-red-600 dark:text-stone-600"
                            title="Remove this citation"
                            @click="removeDraft(index)"
                        >
                            ×
                        </button>
                    </li>
                </template>
            </ul>

            <div class="relative flex flex-wrap items-center gap-2">
                <input
                    v-model="query"
                    type="search"
                    placeholder="Cite… (author, title, year or key)"
                    class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    @input="onQueryInput"
                />
                <button
                    type="button"
                    class="text-stone-500 underline dark:text-stone-400"
                    @click="creating ? closeCreate() : openCreate()"
                >
                    {{ creating ? 'Cancel new item' : '+ New item…' }}
                </button>
                <a
                    :href="bibliographyIndex.url()"
                    target="_blank"
                    rel="noopener"
                    class="text-stone-400 underline dark:text-stone-600"
                    >Open the bibliography</a
                >

                <ul
                    v-if="results.length > 0"
                    class="absolute top-full left-0 z-20 mt-1 max-h-60 w-full overflow-y-auto rounded border border-stone-300 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900"
                >
                    <li v-for="item in results" :key="item.id">
                        <button
                            type="button"
                            class="block w-full px-2 py-1 text-left hover:bg-stone-100 disabled:opacity-40 dark:hover:bg-stone-800"
                            :disabled="citedItemIds.has(item.id)"
                            @mousedown.prevent
                            @click="attach(item)"
                        >
                            <span class="font-medium">{{ item.label }}</span>
                            <span
                                class="block text-stone-500 dark:text-stone-400"
                                >{{ item.reference }}</span
                            >
                        </button>
                    </li>
                </ul>
                <p
                    v-else-if="query.trim() !== '' && !searching"
                    class="w-full text-stone-500 dark:text-stone-400"
                >
                    Nothing in the bibliography matches — add it as a new item.
                </p>
            </div>

            <BibliographyItemForm
                v-if="creating"
                :registry="props.registry"
                :suggestions="props.suggestions"
                @cancel="closeCreate"
            />
        </template>
    </div>
</template>
