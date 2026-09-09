<script setup lang="ts">
import { useForm } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
import {
    biblatexEntry,
    emptySuggestions,
    FIELD_GROUP_LABELS,
    parseNames,
    serializeNames,
} from '@/lib/biblatex';
import type {
    BiblatexRegistry,
    FieldSpec,
    Name,
    Suggestions,
} from '@/lib/biblatex';
import {
    store as storeItem,
    update as updateItem,
} from '@/routes/bibliography';

/**
 * One biblatex entry, edited: the type, the standard fields for that type,
 * any further field the editor adds from the full biblatex list, and a
 * live preview of the entry as it will export. Name-list fields are edited
 * as rows of family and given names and serialized to biblatex's
 * "Last, First and Last, First" on the way out. Used on the bibliography
 * page and, later, inline from the references picker.
 */
export type EditableItem = {
    id: number;
    entry_type: string;
    citation_key: string;
    fields: Record<string, string>;
};

const props = withDefaults(
    defineProps<{
        registry: BiblatexRegistry;
        /** The item being edited; absent for a new one. */
        item?: EditableItem | null;
        /**
         * What the list already records — offered while typing a name, a
         * publisher, a journal, a place or a series, so spellings converge
         * on what is there. Never enforced: a new author is exactly what a
         * new item may bring.
         */
        suggestions?: Suggestions;
    }>(),
    { item: null, suggestions: () => emptySuggestions() },
);

// Datalist ids must be unique per form instance — the page can show the
// add form and an edit form at once.
const uid = Math.random().toString(36).slice(2, 8);

/**
 * Whole persons, "Family, Given", offered on the family input — choosing
 * one fills both fields. One list, one spelling: the point is that
 * "U. Wilamowitz", "Ulrich Wilamowitz" and "U. Wilamowitz-Moellendorff"
 * do not become three people (user decision), which separate family and
 * given suggestions could not prevent.
 */
const personSuggestions = computed(() => [
    ...new Set(
        props.suggestions.names.map((name) =>
            name.given === '' ? name.family : `${name.family}, ${name.given}`,
        ),
    ),
]);

/**
 * The given-name box offers the same "Family, Given" list (browsers match
 * a datalist on any part of the value, so typing "Ulrich" still finds
 * Wilamowitz); a chosen person fills both boxes here too.
 */
function onGivenInput(field: string, name: Name) {
    const match = props.suggestions.names.find(
        (candidate) =>
            candidate.given !== '' &&
            name.given === `${candidate.family}, ${candidate.given}`,
    );

    if (match) {
        name.family = match.family;
        name.given = match.given;
    }

    syncNames(field);
}

/**
 * A chosen suggestion (or a "Family, Given" typed whole into the family
 * box) is split into its two fields.
 */
function onFamilyInput(field: string, name: Name) {
    const typed = name.family;
    const match = props.suggestions.names.find(
        (candidate) =>
            typed === `${candidate.family}, ${candidate.given}` ||
            (candidate.given === '' && typed === candidate.family),
    );

    if (match) {
        name.family = match.family;
        name.given = match.given;
    } else if (typed.includes(',')) {
        const [family, ...given] = typed.split(',');
        name.family = family.trim();
        name.given = given.join(',').trim();
    }

    syncNames(field);
}

/** The datalist a literal field draws on, if the list has one for it. */
function listFor(field: string): string | undefined {
    return field === 'publisher' ||
        field === 'journaltitle' ||
        field === 'location' ||
        field === 'series'
        ? `bib-${uid}-${field}`
        : undefined;
}

const emit = defineEmits<{
    (e: 'saved'): void;
    (e: 'cancel'): void;
}>();

const form = useForm<{
    entry_type: string;
    citation_key: string;
    fields: Record<string, string>;
}>({
    entry_type: props.item?.entry_type ?? 'book',
    citation_key: props.item?.citation_key ?? '',
    fields: { ...(props.item?.fields ?? {}) },
});

const specByName = computed<Record<string, FieldSpec>>(() =>
    Object.fromEntries(props.registry.fields.map((spec) => [spec.name, spec])),
);

// Fields the editor has opened beyond the type's standard set — kept so an
// added field stays visible while still empty.
const extraFields = ref<string[]>(
    Object.keys(props.item?.fields ?? {}).filter(
        (name) =>
            !(
                props.registry.standard[props.item?.entry_type ?? 'book'] ?? []
            ).includes(name),
    ),
);

const visibleFields = computed<FieldSpec[]>(() => {
    const standard = props.registry.standard[form.entry_type] ?? [];
    const names = [
        ...standard,
        ...extraFields.value.filter((name) => !standard.includes(name)),
    ];

    return names
        .map((name) => specByName.value[name])
        .filter((spec): spec is FieldSpec => spec !== undefined);
});

// Switching type keeps every value: what was entered is still true of the
// work. Fields the new type does not show by default move to the extras.
watch(
    () => form.entry_type,
    (type) => {
        const standard = props.registry.standard[type] ?? [];
        const kept = Object.keys(form.fields).filter(
            (name) =>
                (form.fields[name] ?? '').trim() !== '' &&
                !standard.includes(name),
        );
        extraFields.value = [...new Set([...extraFields.value, ...kept])];
    },
);

const addableFields = computed(() => {
    const visible = new Set(visibleFields.value.map((spec) => spec.name));
    const groups = new Map<string, FieldSpec[]>();

    for (const spec of props.registry.fields) {
        if (visible.has(spec.name)) {
            continue;
        }

        groups.set(spec.group, [...(groups.get(spec.group) ?? []), spec]);
    }

    return [...groups.entries()].map(([group, fields]) => ({
        group,
        label: FIELD_GROUP_LABELS[group] ?? group,
        fields,
    }));
});

const addFieldName = ref('');

function addField() {
    if (addFieldName.value === '') {
        return;
    }

    extraFields.value = [...extraFields.value, addFieldName.value];
    addFieldName.value = '';
}

function removeField(name: string) {
    delete form.fields[name];
    extraFields.value = extraFields.value.filter((field) => field !== name);
}

// ---- name lists: rows of family/given, serialized on every change ----
const nameRows = ref<Record<string, Name[]>>({});

function namesFor(field: string): Name[] {
    if (!nameRows.value[field]) {
        const parsed = parseNames(form.fields[field] ?? '');
        nameRows.value[field] =
            parsed.length > 0 ? parsed : [{ family: '', given: '' }];
    }

    return nameRows.value[field];
}

function syncNames(field: string) {
    form.fields[field] = serializeNames(nameRows.value[field] ?? []);
}

function addName(field: string) {
    namesFor(field).push({ family: '', given: '' });
}

function removeName(field: string, index: number) {
    const rows = namesFor(field);
    rows.splice(index, 1);

    if (rows.length === 0) {
        rows.push({ family: '', given: '' });
    }

    syncNames(field);
}

function placeholderFor(spec: FieldSpec): string {
    switch (spec.kind) {
        case 'date':
            return '1927, 1927-05 or 1927/1930';
        case 'range':
            return '45--67';
        case 'list':
            return 'Oxford and New York';
        case 'uri':
            return 'https://';
        case 'keylist':
            return 'greek and latin';
        default:
            return '';
    }
}

const preview = computed(() =>
    biblatexEntry(
        form.entry_type,
        form.citation_key,
        form.fields,
        props.registry,
    ),
);

function submit() {
    const options = {
        preserveScroll: true,
        onSuccess: () => emit('saved'),
    };

    if (props.item) {
        form.patch(updateItem.url(props.item.id), options);
    } else {
        form.post(storeItem.url(), options);
    }
}
</script>

<template>
    <form
        class="flex flex-col gap-2 rounded border border-stone-200 bg-stone-50 p-3 text-xs dark:border-stone-800 dark:bg-stone-900/50"
        @submit.prevent="submit"
    >
        <div class="flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-0.5">
                Type
                <select
                    v-model="form.entry_type"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
                >
                    <option
                        v-for="type in props.registry.types"
                        :key="type"
                        :value="type"
                    >
                        {{ type }}
                    </option>
                </select>
            </label>
            <label class="flex flex-col gap-0.5">
                Citation key
                <input
                    v-model="form.citation_key"
                    type="text"
                    placeholder="generated from author and year"
                    class="w-56 rounded border border-stone-300 bg-transparent px-2 py-1 font-mono dark:border-stone-700"
                />
            </label>
            <span
                v-if="form.errors.citation_key"
                class="text-red-600 dark:text-red-400"
                >{{ form.errors.citation_key }}</span
            >
        </div>

        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div
                v-for="spec in visibleFields"
                :key="spec.name"
                class="flex flex-col gap-0.5"
                :class="spec.kind === 'name' ? 'md:col-span-2' : ''"
            >
                <span class="flex items-center justify-between">
                    <span>
                        {{ spec.label }}
                        <span
                            class="ml-1 font-mono text-stone-400 dark:text-stone-600"
                            >{{ spec.name }}</span
                        >
                    </span>
                    <button
                        type="button"
                        class="text-stone-400 hover:text-red-600 dark:text-stone-600"
                        :title="`Remove ${spec.name}`"
                        @click="removeField(spec.name)"
                    >
                        ×
                    </button>
                </span>

                <!-- A name list is rows of family and given names. -->
                <template v-if="spec.kind === 'name'">
                    <div
                        v-for="(name, index) in namesFor(spec.name)"
                        :key="index"
                        class="flex items-center gap-1"
                    >
                        <input
                            v-model="name.family"
                            type="text"
                            placeholder="Family name"
                            :list="`bib-${uid}-persons`"
                            title="Type a family name — picking a suggested person fills both boxes"
                            class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            @input="onFamilyInput(spec.name, name)"
                        />
                        <input
                            v-model="name.given"
                            type="text"
                            placeholder="Given name(s)"
                            :list="`bib-${uid}-persons`"
                            title="Type given names — picking a suggested person fills both boxes"
                            class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            @input="onGivenInput(spec.name, name)"
                        />
                        <button
                            type="button"
                            class="px-1 text-stone-400 hover:text-red-600 dark:text-stone-600"
                            title="Remove this name"
                            @click="removeName(spec.name, index)"
                        >
                            ×
                        </button>
                    </div>
                    <button
                        type="button"
                        class="self-start text-stone-500 underline dark:text-stone-400"
                        @click="addName(spec.name)"
                    >
                        + another name
                    </button>
                </template>
                <textarea
                    v-else-if="
                        spec.name === 'abstract' ||
                        spec.name === 'annotation' ||
                        spec.name === 'note'
                    "
                    v-model="form.fields[spec.name]"
                    rows="2"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                ></textarea>
                <input
                    v-else
                    v-model="form.fields[spec.name]"
                    type="text"
                    :placeholder="placeholderFor(spec)"
                    :list="listFor(spec.name)"
                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                />
                <span
                    v-if="form.errors[`fields.${spec.name}`]"
                    class="text-red-600 dark:text-red-400"
                    >{{ form.errors[`fields.${spec.name}`] }}</span
                >
            </div>
        </div>

        <span
            v-if="form.errors.fields"
            class="text-red-600 dark:text-red-400"
            >{{ form.errors.fields }}</span
        >

        <!-- Every other biblatex field, one pick away. -->
        <label
            class="flex flex-wrap items-center gap-2 text-stone-500 dark:text-stone-400"
        >
            Add field
            <select
                v-model="addFieldName"
                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-950"
                @change="addField"
            >
                <option value="">…</option>
                <optgroup
                    v-for="group in addableFields"
                    :key="group.group"
                    :label="group.label"
                >
                    <option
                        v-for="spec in group.fields"
                        :key="spec.name"
                        :value="spec.name"
                    >
                        {{ spec.label }} ({{ spec.name }})
                    </option>
                </optgroup>
            </select>
        </label>

        <!-- The suggestion lists, one per kind of value the list already
             holds. Browsers filter a datalist by what is typed. -->
        <datalist :id="`bib-${uid}-persons`">
            <option
                v-for="person in personSuggestions"
                :key="person"
                :value="person"
            />
        </datalist>
        <datalist
            v-for="field in [
                'publisher',
                'journaltitle',
                'location',
                'series',
            ] as const"
            :id="`bib-${uid}-${field}`"
            :key="field"
        >
            <option
                v-for="value in props.suggestions[field]"
                :key="value"
                :value="value"
            />
        </datalist>

        <details class="text-stone-500 dark:text-stone-400">
            <summary class="cursor-pointer">biblatex preview</summary>
            <pre
                class="mt-1 overflow-x-auto rounded border border-stone-200 bg-white p-2 font-mono whitespace-pre-wrap dark:border-stone-800 dark:bg-stone-950"
                >{{ preview }}</pre>
        </details>

        <div class="flex items-center gap-2">
            <button
                type="submit"
                class="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                :disabled="form.processing"
            >
                {{ props.item ? 'Save' : 'Add item' }}
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
