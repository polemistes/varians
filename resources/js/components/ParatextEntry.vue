<script setup lang="ts">
import ParatextBox from '@/components/ParatextBox.vue';
import type { ParatextLayout } from '@/lib/paratext';

/**
 * A paratext's place in the running text of the edition page — see
 * EditionParatext and Editions/Show.vue.
 *
 * Every entry leaves an ANCHOR in the flow, a zero-width island the page
 * measures to find the line the paratext belongs to (`data-paratext-anchor`).
 * What else renders here depends on the layout: inline text among the
 * words; a block of its own for a speaker indication set on its own line,
 * followed — where it interrupted a line — by a spacer as wide as the
 * text that stood before it, so the rest of the line goes on below,
 * aligned with where it broke off; nothing more for a margin note, whose
 * box the page draws in the margin.
 */
defineProps<{
    entryKey: string;
    text: string;
    layout: ParatextLayout;
    speaker: boolean;
    editing: boolean;
    editable: boolean;
    /** How far in the interrupted line goes on, in pixels; 0 flows from the left. */
    indent: number;
}>();

const emit = defineEmits<{
    (e: 'save', text: string): void;
    (e: 'cancel'): void;
    (e: 'edit'): void;
}>();
</script>

<template>
    <span
        :data-paratext-anchor="entryKey"
        contenteditable="false"
        data-non-text
        aria-hidden="true"
        >&#8203;</span
    ><ParatextBox
        v-if="layout === 'inline'"
        :text="text"
        :layout="layout"
        :speaker="speaker"
        :editing="editing"
        :editable="editable"
        @save="(value) => emit('save', value)"
        @cancel="emit('cancel')"
        @edit="emit('edit')"
    /><template
        v-else-if="layout === 'own_line' || layout === 'own_line_centered'"
        ><span
            contenteditable="false"
            data-non-text
            class="block"
            :class="layout === 'own_line_centered' && 'text-center'"
            ><ParatextBox
                :text="text"
                :layout="layout"
                :speaker="speaker"
                :editing="editing"
                :editable="editable"
                @save="(value) => emit('save', value)"
                @cancel="emit('cancel')"
                @edit="emit('edit')" /></span
        ><span
            v-if="indent > 0"
            contenteditable="false"
            data-non-text
            class="inline-block"
            aria-hidden="true"
            :style="{ width: `${indent}px` }"
        ></span
    ></template>
</template>
