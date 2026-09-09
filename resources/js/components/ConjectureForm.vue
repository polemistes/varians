<script setup lang="ts">
import { useForm } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
import HierarchicalPassagePicker from '@/components/HierarchicalPassagePicker.vue';
import ReferencePicker from '@/components/ReferencePicker.vue';
import type { BiblatexRegistry, Suggestions } from '@/lib/biblatex';
import {
    store as storeConjecture,
    update as updateConjecture,
} from '@/routes/conjectures';
import type { WorkConjecture, WorkPassage } from '@/types/conjectures';
import type { DraftReference } from '@/types/edition';
import type { ConjectureType, ReferenceLevel } from '@/types/models';

/**
 * One conjecture of any kind, recorded or edited from the Work page: the
 * kind decides which fields show (ConjectureShape on the server decides
 * which are required). A substitution proposes text for a passage; a
 * lacuna marks a gap (with an optional extent); a supplement fills a
 * lacuna of the same passage; a transposition moves a passage or range
 * before or after a target; a reordering arranges a contiguous stretch.
 *
 * A NEW conjecture carries its citations in its own request (draft
 * picker); an existing one edits them in place (live picker, below).
 */
const props = defineProps<{
    passages: WorkPassage[];
    levels: ReferenceLevel[];
    /** The work's lacunas, for a supplement to name the one it fills. */
    lacunas: { id: number; canonical_passage_id: number; label: string }[];
    conjecture?: WorkConjecture | null;
    registry: BiblatexRegistry;
    suggestions: Suggestions;
}>();

const emit = defineEmits<{
    (e: 'saved'): void;
    (e: 'cancel'): void;
}>();

const TYPE_LABELS: Record<ConjectureType, string> = {
    substitution: 'Substitution',
    deletion: 'Deletion',
    lacuna: 'Lacuna',
    supplement: 'Supplement',
    transposition: 'Transposition',
    reordering: 'Reordering',
};

const form = useForm<{
    type: ConjectureType;
    canonical_passage_id: number | null;
    text: string;
    extent: string;
    extent_characters: number | '';
    supplements_conjecture_id: number | null;
    transposition_range_end_canonical_passage_id: number | null;
    move_target_canonical_passage_id: number | null;
    move_position: 'before' | 'after';
    canonical_passage_ids: number[];
    proposed_by: string;
    note: string;
    references: DraftReference[];
}>({
    type: props.conjecture?.type ?? 'substitution',
    canonical_passage_id: props.conjecture?.canonical_passage_id ?? null,
    text: props.conjecture?.text ?? '',
    extent: props.conjecture?.extent ?? '',
    extent_characters: props.conjecture?.extent_characters ?? '',
    supplements_conjecture_id:
        props.conjecture?.supplements_conjecture_id ?? null,
    transposition_range_end_canonical_passage_id:
        props.conjecture?.transposition_range_end_canonical_passage_id ?? null,
    move_target_canonical_passage_id:
        props.conjecture?.move_target_canonical_passage_id ?? null,
    move_position: props.conjecture?.move_position ?? 'after',
    canonical_passage_ids:
        props.conjecture?.ordering.map((entry) => entry.id) ?? [],
    proposed_by: props.conjecture?.proposed_by ?? '',
    note: props.conjecture?.note ?? '',
    references: [],
});

const passageById = computed(
    () => new Map(props.passages.map((passage) => [passage.id, passage])),
);

const lacunasOnPassage = computed(() =>
    props.lacunas.filter(
        (lacuna) => lacuna.canonical_passage_id === form.canonical_passage_id,
    ),
);

// ---- reordering: a contiguous stretch, then arranged ----
// The stretch is chosen by its two ends; the list between them, in
// citation order, is what the editor rearranges.
const stretch = ref<{ from: number | null; to: number | null }>({
    from: props.conjecture?.ordering.length
        ? [...props.conjecture.ordering]
              .map((e) => e.id)
              .sort((a, b) =>
                  (passageById.value.get(a)?.sort_key ?? '').localeCompare(
                      passageById.value.get(b)?.sort_key ?? '',
                  ),
              )[0]
        : null,
    to: props.conjecture?.ordering.length
        ? [...props.conjecture.ordering]
              .map((e) => e.id)
              .sort((a, b) =>
                  (passageById.value.get(b)?.sort_key ?? '').localeCompare(
                      passageById.value.get(a)?.sort_key ?? '',
                  ),
              )[0]
        : null,
});

watch(
    () => [stretch.value.from, stretch.value.to],
    ([from, to]) => {
        if (from === null || to === null) {
            return;
        }

        const fromKey = passageById.value.get(from)?.sort_key ?? '';
        const toKey = passageById.value.get(to)?.sort_key ?? '';
        const [low, high] =
            fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
        const ids = props.passages
            .filter(
                (passage) =>
                    passage.sort_key >= low && passage.sort_key <= high,
            )
            .map((passage) => passage.id);

        // Keep the editor's arrangement where the stretch is unchanged.
        const same =
            ids.length === form.canonical_passage_ids.length &&
            ids.every((id) => form.canonical_passage_ids.includes(id));

        if (!same) {
            form.canonical_passage_ids = ids;
        }
    },
);

function moveEntry(index: number, delta: -1 | 1) {
    const target = index + delta;

    if (target < 0 || target >= form.canonical_passage_ids.length) {
        return;
    }

    const ids = [...form.canonical_passage_ids];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    form.canonical_passage_ids = ids;
}

function labelOf(id: number): string {
    return passageById.value.get(id)?.label ?? String(id);
}

const canSubmit = computed(() =>
    form.type === 'reordering'
        ? form.canonical_passage_ids.length >= 2
        : form.canonical_passage_id !== null,
);

function submit() {
    const options = {
        preserveScroll: true,
        onSuccess: () => emit('saved'),
    };

    const payload = form.transform((data) => ({
        type: data.type,
        canonical_passage_id: data.canonical_passage_id,
        text: data.text || null,
        extent: data.extent || null,
        extent_characters:
            data.extent_characters === '' ? null : data.extent_characters,
        supplements_conjecture_id: data.supplements_conjecture_id,
        transposition_range_end_canonical_passage_id:
            data.transposition_range_end_canonical_passage_id,
        move_target_canonical_passage_id: data.move_target_canonical_passage_id,
        move_position: data.move_position,
        canonical_passage_ids: data.canonical_passage_ids,
        proposed_by: data.proposed_by || null,
        note: data.note || null,
        references: data.references.map((reference) => ({
            item_id: reference.item_id,
            prenote: reference.prenote || null,
            postnote: reference.postnote || null,
        })),
    }));

    if (props.conjecture) {
        payload.patch(updateConjecture.url(props.conjecture.id), options);

        return;
    }

    // A reordering hangs from its first passage; the server settles the
    // anchor, the route only needs some passage of the stretch.
    const passageId =
        form.type === 'reordering'
            ? form.canonical_passage_ids[0]
            : form.canonical_passage_id;

    if (passageId == null) {
        return;
    }

    payload.post(storeConjecture.url(passageId), options);
}

const fieldError = (field: string) =>
    form.errors[field as keyof typeof form.errors];
</script>

<template>
    <form
        class="flex flex-col gap-2 rounded border border-stone-200 bg-stone-50 p-3 text-xs dark:border-stone-800 dark:bg-stone-900/50"
        @submit.prevent="submit"
    >
        <div class="flex flex-wrap items-end gap-3">
            <label class="flex flex-col gap-0.5">
                Kind
                <select
                    v-model="form.type"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
                >
                    <option
                        v-for="(label, type) in TYPE_LABELS"
                        :key="type"
                        :value="type"
                    >
                        {{ label }}
                    </option>
                </select>
            </label>
            <span
                v-if="fieldError('type')"
                class="text-red-600 dark:text-red-400"
                >{{ fieldError('type') }}</span
            >

            <template v-if="form.type !== 'reordering'">
                <span class="flex flex-col gap-0.5">
                    {{
                        form.type === 'transposition'
                            ? 'Passage (start of range)'
                            : 'Passage'
                    }}
                    <HierarchicalPassagePicker
                        v-model="form.canonical_passage_id"
                        :passages="props.passages"
                        :levels="props.levels"
                    />
                </span>
            </template>
        </div>

        <!-- Substitution / supplement: the proposed text. -->
        <label
            v-if="form.type === 'substitution' || form.type === 'supplement'"
            class="flex flex-col gap-0.5"
        >
            Proposed text
            <input
                v-model="form.text"
                type="text"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 font-serif text-base dark:border-stone-700"
            />
            <span
                v-if="fieldError('text')"
                class="text-red-600 dark:text-red-400"
                >{{ fieldError('text') }}</span
            >
        </label>

        <!-- Supplement: which lacuna. -->
        <label v-if="form.type === 'supplement'" class="flex flex-col gap-0.5">
            Fills the lacuna
            <select
                v-model="form.supplements_conjecture_id"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
            >
                <option :value="null" disabled>
                    {{
                        form.canonical_passage_id === null
                            ? 'Choose the passage first'
                            : lacunasOnPassage.length === 0
                              ? 'No lacuna recorded on this passage'
                              : 'Choose…'
                    }}
                </option>
                <option
                    v-for="lacuna in lacunasOnPassage"
                    :key="lacuna.id"
                    :value="lacuna.id"
                >
                    {{ lacuna.label }}
                </option>
            </select>
            <span
                v-if="fieldError('supplements_conjecture_id')"
                class="text-red-600 dark:text-red-400"
                >{{ fieldError('supplements_conjecture_id') }}</span
            >
        </label>

        <!-- Lacuna: how much is missing. -->
        <div v-if="form.type === 'lacuna'" class="flex flex-wrap gap-2">
            <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                Extent (optional)
                <input
                    v-model="form.extent"
                    type="text"
                    placeholder="e.g. one line"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                />
            </label>
            <label class="flex flex-col gap-0.5">
                Estimated characters
                <input
                    v-model.number="form.extent_characters"
                    type="number"
                    min="0"
                    class="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                />
            </label>
        </div>

        <!-- Transposition: the range's end, and where it goes. -->
        <div
            v-if="form.type === 'transposition'"
            class="flex flex-wrap items-end gap-3"
        >
            <span class="flex flex-col gap-0.5">
                End of range (optional)
                <HierarchicalPassagePicker
                    v-model="form.transposition_range_end_canonical_passage_id"
                    :passages="props.passages"
                    :levels="props.levels"
                />
            </span>
            <label class="flex flex-col gap-0.5">
                Moves
                <select
                    v-model="form.move_position"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
                >
                    <option value="before">before</option>
                    <option value="after">after</option>
                </select>
            </label>
            <span class="flex flex-col gap-0.5">
                Target passage
                <HierarchicalPassagePicker
                    v-model="form.move_target_canonical_passage_id"
                    :passages="props.passages"
                    :levels="props.levels"
                />
            </span>
            <span
                v-if="
                    fieldError('move_target_canonical_passage_id') ||
                    fieldError('move_position') ||
                    fieldError('transposition_range_end_canonical_passage_id')
                "
                class="w-full text-red-600 dark:text-red-400"
                >{{
                    fieldError('move_target_canonical_passage_id') ??
                    fieldError('move_position') ??
                    fieldError('transposition_range_end_canonical_passage_id')
                }}</span
            >
        </div>

        <!-- Reordering: a stretch, then its arrangement. -->
        <div v-if="form.type === 'reordering'" class="flex flex-col gap-2">
            <div class="flex flex-wrap items-end gap-3">
                <span class="flex flex-col gap-0.5">
                    From
                    <HierarchicalPassagePicker
                        v-model="stretch.from"
                        :passages="props.passages"
                        :levels="props.levels"
                    />
                </span>
                <span class="flex flex-col gap-0.5">
                    To
                    <HierarchicalPassagePicker
                        v-model="stretch.to"
                        :passages="props.passages"
                        :levels="props.levels"
                    />
                </span>
            </div>
            <ol
                v-if="form.canonical_passage_ids.length > 0"
                class="flex flex-col gap-1"
            >
                <li
                    v-for="(id, index) in form.canonical_passage_ids"
                    :key="id"
                    class="flex items-center justify-between gap-2 rounded border border-stone-200 px-2 py-1 dark:border-stone-800"
                >
                    <span>{{ labelOf(id) }}</span>
                    <span class="flex gap-2">
                        <button
                            type="button"
                            class="underline disabled:opacity-30"
                            :disabled="index === 0"
                            @click="moveEntry(index, -1)"
                        >
                            &uarr;
                        </button>
                        <button
                            type="button"
                            class="underline disabled:opacity-30"
                            :disabled="
                                index === form.canonical_passage_ids.length - 1
                            "
                            @click="moveEntry(index, 1)"
                        >
                            &darr;
                        </button>
                    </span>
                </li>
            </ol>
            <span
                v-if="fieldError('canonical_passage_ids')"
                class="text-red-600 dark:text-red-400"
                >{{ fieldError('canonical_passage_ids') }}</span
            >
        </div>

        <div class="flex flex-wrap gap-2">
            <label class="flex min-w-0 flex-1 flex-col gap-0.5">
                First proposed by
                <input
                    v-model="form.proposed_by"
                    type="text"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                />
            </label>
        </div>

        <label class="flex flex-col gap-0.5">
            Note
            <textarea
                v-model="form.note"
                rows="2"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
            ></textarea>
        </label>

        <!-- Citations: drafted with a new conjecture, edited in place on an
             existing one (the record exists to cite from). -->
        <div class="flex flex-col gap-0.5">
            <span class="text-stone-500 dark:text-stone-400">References</span>
            <ReferencePicker
                v-if="props.conjecture"
                :target="{ conjecture_id: props.conjecture.id }"
                :references="props.conjecture.references"
                :registry="props.registry"
                :suggestions="props.suggestions"
            />
            <ReferencePicker
                v-else
                v-model="form.references"
                :registry="props.registry"
                :suggestions="props.suggestions"
            />
        </div>

        <div class="flex items-center gap-2">
            <button
                type="submit"
                class="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                :disabled="form.processing || !canSubmit"
            >
                {{ props.conjecture ? 'Save' : 'Record conjecture' }}
            </button>
            <button
                type="button"
                class="text-stone-500 underline dark:text-stone-400"
                @click="emit('cancel')"
            >
                Cancel
            </button>
        </div>
    </form>
</template>
