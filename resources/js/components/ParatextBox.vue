<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { ParatextLayout } from '@/lib/paratext';

/**
 * One paratext, read or being written: the words in paratext style, or —
 * while the editor is writing it — the same box made editable. The box is
 * an island in the edition text (`contenteditable="false"`), so the page's
 * text handlers leave what happens inside it alone; the editable field
 * nested in it takes the keys instead.
 *
 * Enter keeps the text (Shift+Enter breaks a line in a margin note),
 * Escape discards the change, and leaving the field keeps it. An empty
 * text on keeping is a removal.
 */
const props = defineProps<{
    text: string;
    layout: ParatextLayout;
    /** A speaker indication is set apart from other paratext. */
    speaker: boolean;
    /** Open for writing. */
    editing: boolean;
    /** Clicking it opens it for writing. */
    editable: boolean;
}>();

const emit = defineEmits<{
    (e: 'save', text: string): void;
    (e: 'cancel'): void;
    (e: 'edit'): void;
}>();

const fieldEl = ref<HTMLElement | null>(null);
// A margin note may run to several lines; the others are one line.
const multilineEditor =
    props.layout === 'left_margin' || props.layout === 'right_margin';
// Escape and Enter both blur the field; this says which of them did, so
// the blur that follows does not keep what Escape discarded.
let settled = false;

function focusField() {
    const el = fieldEl.value;

    if (!el) {
        return;
    }

    el.focus();

    if (el instanceof HTMLTextAreaElement) {
        el.setSelectionRange(el.value.length, el.value.length);

        return;
    }

    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

onMounted(() => {
    if (props.editing) {
        void nextTick(focusField);
    }
});

watch(
    () => props.editing,
    (editing) => {
        settled = false;

        if (editing) {
            void nextTick(focusField);
        }
    },
);

function currentText(): string {
    const el = fieldEl.value;

    if (!el) {
        return props.text;
    }

    return (
        el instanceof HTMLTextAreaElement ? el.value : el.innerText
    ).replace(/\s+$/u, '');
}

function keep() {
    settled = true;
    emit('save', currentText());
}

function discard() {
    settled = true;
    emit('cancel');
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault();
        discard();

        return;
    }

    if (event.key === 'Enter' && !(multilineEditor && event.shiftKey)) {
        event.preventDefault();
        keep();
    }
}

function onBlur() {
    if (!settled) {
        keep();
    }
}
</script>

<template>
    <span
        contenteditable="false"
        data-non-text
        class="paratext font-sans"
        :class="[
            speaker
                ? 'tracking-wide text-violet-800 uppercase dark:text-violet-300'
                : 'text-violet-800 italic dark:text-violet-300',
            layout === 'inline' && 'mx-0.5 text-sm',
            (layout === 'own_line' || layout === 'own_line_centered') &&
                'text-sm',
            (layout === 'left_margin' || layout === 'right_margin') &&
                'block text-xs leading-snug whitespace-pre-wrap',
            editable && !editing && 'cursor-text hover:underline',
        ]"
        :title="editable && !editing ? 'Click to reword or remove' : undefined"
        @click="editable && !editing && emit('edit')"
    >
        <template v-if="!editing">{{ text }}</template>
        <textarea
            v-else-if="multilineEditor"
            ref="fieldEl"
            :value="text"
            rows="2"
            class="w-full resize-none rounded border border-violet-300 bg-white px-1 py-0.5 text-inherit outline-none dark:border-violet-700 dark:bg-stone-900"
            @keydown="onKeydown"
            @blur="onBlur"
        ></textarea>
        <span
            v-else
            ref="fieldEl"
            contenteditable="true"
            class="inline-block min-w-[1ch] rounded border border-violet-300 bg-white px-1 outline-none dark:border-violet-700 dark:bg-stone-900"
            @keydown="onKeydown"
            @blur="onBlur"
            >{{ text }}</span
        >
    </span>
</template>
