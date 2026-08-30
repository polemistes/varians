<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ReferenceLevel } from '@/types/models';

type PassageOption = {
    id: number;
    address: Record<string, string | number>;
};

type TreeNode = {
    value: string | number;
    passageId: number | null;
    children: TreeNode[];
};

const props = defineProps<{
    passages: PassageOption[];
    levels: ReferenceLevel[];
    modelValue: number | null;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: number | null): void;
}>();

// A passage is always fully qualified (every level present) — there's no
// separate "book-only" citation — so the picker's hierarchy is derived by
// grouping the flat passage list, not fetched from anywhere new.
const tree = computed<TreeNode[]>(() => {
    const root: TreeNode[] = [];

    for (const passage of props.passages) {
        let siblings = root;
        let node: TreeNode | undefined;

        for (const level of props.levels) {
            const value = passage.address[level.key];
            node = siblings.find((candidate) => candidate.value === value);

            if (!node) {
                node = { value, passageId: null, children: [] };
                siblings.push(node);
            }

            siblings = node.children;
        }

        if (node) {
            node.passageId = passage.id;
        }
    }

    return root;
});

// One selected address value per level, e.g. [1, 5] for book 1, line 5.
const selections = ref<(string | number | null)[]>(
    props.levels.map(() => null),
);

function optionsAt(levelIndex: number): TreeNode[] {
    let nodes = tree.value;

    for (let i = 0; i < levelIndex; i++) {
        const node = nodes.find(
            (candidate) => candidate.value === selections.value[i],
        );

        if (!node) {
            return [];
        }

        nodes = node.children;
    }

    return nodes;
}

function selectAt(levelIndex: number, raw: string) {
    const value =
        raw === ''
            ? null
            : props.levels[levelIndex].type === 'integer'
              ? Number(raw)
              : raw;

    selections.value[levelIndex] = value;

    // Choosing a level invalidates every deeper one — they no longer refer
    // to a child of the newly chosen node.
    for (let i = levelIndex + 1; i < selections.value.length; i++) {
        selections.value[i] = null;
    }
}

const resolvedPassageId = computed<number | null>(() => {
    let nodes = tree.value;
    let node: TreeNode | undefined;

    for (const selected of selections.value) {
        if (selected === null) {
            return null;
        }

        node = nodes.find((candidate) => candidate.value === selected);

        if (!node) {
            return null;
        }

        nodes = node.children;
    }

    return node?.passageId ?? null;
});

watch(resolvedPassageId, (value) => emit('update:modelValue', value));

// The parent resets the model back to null after a successful submit —
// mirror that here so the dropdowns clear along with the rest of the form.
watch(
    () => props.modelValue,
    (value) => {
        if (value === null) {
            selections.value = props.levels.map(() => null);
        }
    },
);
</script>

<template>
    <span class="inline-flex items-center gap-1">
        <select
            v-for="(level, index) in props.levels"
            :key="level.key"
            :value="selections[index] ?? ''"
            :disabled="index > 0 && selections[index - 1] === null"
            class="rounded border border-stone-300 bg-transparent px-2 py-1 disabled:opacity-40 dark:border-stone-700"
            @change="
                selectAt(index, ($event.target as HTMLSelectElement).value)
            "
        >
            <option value="" disabled>{{ level.label }}&hellip;</option>
            <option
                v-for="option in optionsAt(index)"
                :key="option.value"
                :value="option.value"
            >
                {{ option.value }}
            </option>
        </select>
    </span>
</template>
