<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { TextEditOp } from '@/lib/transcriptionEdit';
import { parseTranscriptionMarkup } from '@/lib/transcriptionMarkup';
import type { MarkupToken } from '@/lib/transcriptionMarkup';
import type { TranscriptionRegion, TranscriptionSegment } from '@/types/models';

const props = withDefaults(
    defineProps<{
        text: string;
        regions?: TranscriptionRegion[];
        segments?: TranscriptionSegment[];
        highlightedRegionId?: number | null;
        editableRegionId?: number | null;
        selectionStart?: number | null;
        selectionEnd?: number | null;
        editable?: boolean;
        // Segments whose canonical passage is already in some target
        // edition — greyed out instead of the normal citation-badge
        // treatment. Purely visual (see AddToEditionPanel.vue); rendering
        // doesn't otherwise change what's selectable.
        unavailableSegmentIds?: number[];
    }>(),
    {
        regions: () => [],
        segments: () => [],
        highlightedRegionId: null,
        editableRegionId: null,
        selectionStart: null,
        selectionEnd: null,
        editable: false,
        unavailableSegmentIds: () => [],
    },
);

const emit = defineEmits<{
    (
        e: 'select',
        selection: { start: number; end: number; text: string },
    ): void;
    (e: 'hover-region', id: number | null): void;
    (e: 'badge-click', segment: TranscriptionSegment): void;
    (e: 'edit', op: TextEditOp): void;
}>();

const containerEl = ref<HTMLElement | null>(null);

type Chunk = {
    text: string;
    regionId: number | null;
    markup: Exclude<MarkupToken, { type: 'text' }> | null;
    segment: TranscriptionSegment | null;
    segmentStart: boolean;
    selected: boolean;
    menuAfter: boolean;
};

// Region boundaries (image-alignment), citation-span boundaries, and
// markup-token boundaries (gaps, uncertain readings) are three independent
// dimensions that can partially overlap, so all three are merged into one set
// of cut points. Rendering never changes the underlying characters — only
// wraps them in extra styling spans — so the character offsets region/segment
// selection relies on stay valid no matter what markup exists.
const chunks = computed<Chunk[]>(() => {
    const regions = [...props.regions]
        .filter(
            (region) =>
                region.start_offset >= 0 &&
                region.end_offset <= props.text.length,
        )
        .sort((a, b) => a.start_offset - b.start_offset);

    const segments = [...props.segments]
        .filter(
            (segment) =>
                segment.start_offset >= 0 &&
                segment.end_offset <= props.text.length,
        )
        .sort((a, b) => a.start_offset - b.start_offset);

    const markupSpans = parseTranscriptionMarkup(props.text).filter(
        (token) => token.type !== 'text',
    ) as Exclude<MarkupToken, { type: 'text' }>[];

    const points = new Set<number>([0, props.text.length]);

    for (const region of regions) {
        points.add(region.start_offset);
        points.add(region.end_offset);
    }

    for (const segment of segments) {
        points.add(segment.start_offset);
        points.add(segment.end_offset);
    }

    for (const span of markupSpans) {
        points.add(span.start);
        points.add(span.end);
    }

    // The active selection (if any) is also a cut point, on both ends — this
    // guarantees a chunk boundary exists exactly where the selection ends, so
    // the contextual menu slot below can be inserted at exactly that point in
    // the text flow rather than in a separate panel elsewhere on the page.
    if (props.selectionStart !== null) {
        points.add(props.selectionStart);
    }

    if (props.selectionEnd !== null) {
        points.add(props.selectionEnd);
    }

    const sorted = [...points].sort((a, b) => a - b);
    const result: Chunk[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
        const start = sorted[i];
        const end = sorted[i + 1];

        if (start >= end) {
            continue;
        }

        const region = regions.find(
            (r) => r.start_offset <= start && r.end_offset >= end,
        );
        const segment = segments.find(
            (s) => s.start_offset <= start && s.end_offset >= end,
        );
        const markup = markupSpans.find(
            (span) => span.start <= start && span.end >= end,
        );

        result.push({
            text: props.text.slice(start, end),
            regionId: region ? region.id : null,
            markup: markup ?? null,
            segment: segment ?? null,
            segmentStart: segment ? segment.start_offset === start : false,
            selected:
                props.selectionStart !== null &&
                props.selectionEnd !== null &&
                start >= props.selectionStart &&
                end <= props.selectionEnd,
            menuAfter:
                props.selectionEnd !== null && end === props.selectionEnd,
        });
    }

    return result;
});

function markupClasses(markup: Chunk['markup']) {
    if (!markup) {
        return [];
    }

    if (markup.type === 'supplied') {
        return ['rounded-sm bg-sky-100 dark:bg-sky-950'];
    }

    if (markup.type === 'unclear') {
        return ['underline decoration-dotted decoration-2 underline-offset-2'];
    }

    // gap
    return markup.reason === 'illegible'
        ? ['text-stone-400 italic dark:text-stone-600']
        : [
              'rounded-sm bg-stone-100 text-stone-400 italic dark:bg-stone-900 dark:text-stone-600',
          ];
}

function markupTitle(markup: Chunk['markup']): string | undefined {
    if (!markup) {
        return undefined;
    }

    if (markup.type === 'supplied') {
        return 'Restored — lost in the original';
    }

    if (markup.type === 'unclear') {
        return 'Uncertain reading';
    }

    const extent =
        markup.quantity !== null
            ? `~${markup.quantity} characters`
            : 'extent unknown';

    return markup.reason === 'illegible'
        ? `Illegible (ink survives) — ${extent}`
        : `Lost — ${extent}`;
}

function badgeClasses(segment: TranscriptionSegment) {
    if (segment.needs_review) {
        return 'border border-dashed border-red-500 text-red-600 dark:text-red-400';
    }

    if (props.unavailableSegmentIds.includes(segment.id)) {
        return 'bg-stone-100 text-stone-400 line-through dark:bg-stone-900 dark:text-stone-600';
    }

    return 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400';
}

function badgeTitle(segment: TranscriptionSegment): string {
    if (segment.needs_review) {
        return 'The underlying text changed here — please recheck this mapping';
    }

    if (props.unavailableSegmentIds.includes(segment.id)) {
        return 'Already added to the edition';
    }

    return segment.canonical_passage?.work?.title ?? '';
}

// A region mapping has no persistent highlight of its own — it only lights
// up on hover (amber, matching the square on the facsimile), or more
// prominently when that square is the one currently selected for
// moving/resizing (orange, so the two states read as visibly distinct).
function regionClasses(regionId: Chunk['regionId']) {
    if (!regionId) {
        return [];
    }

    if (regionId === props.editableRegionId) {
        return ['rounded-sm border-b-2 border-orange-500 bg-orange-400/40'];
    }

    if (regionId === props.highlightedRegionId) {
        return ['rounded-sm border-b-2 border-amber-400 bg-amber-300/50'];
    }

    return [];
}

// Citation badges and the contextual selection menu both render real DOM
// text/form content that isn't part of `props.text`, so a naive
// range.toString().length would overcount. Both are marked [data-non-text]
// (as one unit each, so a menu's own buttons aren't double-subtracted) and
// excluded here.
function offsetAt(node: Node, offset: number): number {
    const range = document.createRange();
    range.setStart(containerEl.value!, 0);
    range.setEnd(node, offset);

    let length = range.toString().length;

    for (const el of range
        .cloneContents()
        .querySelectorAll('[data-non-text]')) {
        length -= el.textContent?.length ?? 0;
    }

    return length;
}

function onBadgeClick(segment: TranscriptionSegment) {
    // Badges stay visible while editing (so a scholar sees existing
    // citation boundaries move live while typing) but aren't clickable —
    // the align/assign popovers make no sense mid-edit.
    if (props.editable) {
        return;
    }

    emit('badge-click', segment);
}

function onMouseUp() {
    // In edit mode, text selection is just normal caret/selection behavior
    // for cut/copy/delete — not a request to align or cite a span.
    if (props.editable) {
        return;
    }

    const selection = window.getSelection();

    if (
        !selection ||
        selection.isCollapsed ||
        !containerEl.value ||
        !selection.anchorNode ||
        !selection.focusNode
    ) {
        return;
    }

    if (
        !containerEl.value.contains(selection.anchorNode) ||
        !containerEl.value.contains(selection.focusNode)
    ) {
        return;
    }

    const a = offsetAt(selection.anchorNode, selection.anchorOffset);
    const b = offsetAt(selection.focusNode, selection.focusOffset);
    const [start, end] = a < b ? [a, b] : [b, a];

    if (end - start < 1) {
        return;
    }

    emit('select', { start, end, text: props.text.slice(start, end) });
    selection.removeAllRanges();
}

// Listening on `document` rather than on this (inline, tightly-wrapped)
// container is deliberate: a drag that ends in the sliver of space just past
// the last character of a line can release the pointer outside this span's
// own box (onto its parent), where a listener scoped to the span would never
// see the event. `contains()` above already filters to selections that
// belong to this component, so listening globally is exactly as precise.
onMounted(() => document.addEventListener('mouseup', onMouseUp));
onUnmounted(() => document.removeEventListener('mouseup', onMouseUp));

// ---- edit-text mode: a controlled contenteditable surface ----
//
// Every content-changing beforeinput is prevented and translated into an
// exact {start, end, text} operation instead, which the parent applies to
// its own copy of the text/spans (see transcriptionEdit.ts) and hands back
// down as new props — this component never mutates the DOM itself for a
// text change, only re-renders from `chunks` like it always has. The caret
// is then explicitly restored, since freshly-rendered chunks have no stable
// per-character DOM identity for the browser to have kept it anchored to.
let compositionStart: number | null = null;
let compositionEnd: number | null = null;

function opFromBeforeInput(event: InputEvent): TextEditOp | null {
    const range = event.getTargetRanges()[0];

    if (!range) {
        return null;
    }

    const start = offsetAt(range.startContainer, range.startOffset);
    const end = offsetAt(range.endContainer, range.endOffset);

    switch (event.inputType) {
        case 'insertText':
        case 'insertReplacementText':
            return { start, end, text: event.data ?? '' };
        case 'insertFromPaste':
        case 'insertFromPasteAsQuotation':
        case 'insertFromDrop':
            return {
                start,
                end,
                text: event.dataTransfer?.getData('text/plain') ?? '',
            };
        case 'insertLineBreak':
        case 'insertParagraph':
            return { start, end, text: '\n' };
        case 'deleteContentBackward':
        case 'deleteContentForward':
        case 'deleteWordBackward':
        case 'deleteWordForward':
        case 'deleteByCut':
        case 'deleteByDrag':
        case 'deleteSoftLineBackward':
        case 'deleteSoftLineForward':
        case 'deleteHardLineBackward':
        case 'deleteHardLineForward':
        case 'deleteEntireSoftLine':
            return { start, end, text: '' };
        default:
            return null;
    }
}

function applyAndRestoreCaret(op: TextEditOp) {
    const targetOffset = op.start + [...op.text].length;

    emit('edit', op);
    void nextTick(() => restoreCaret(targetOffset));
}

function onBeforeInput(event: InputEvent) {
    // beforeinput bubbles — a nested form control rendered through the
    // #selection-menu slot (e.g. the "assign" citation label input) fires it
    // too, and without this guard every keystroke typed there would be
    // intercepted and prevented even outside edit mode.
    if (!props.editable) {
        return;
    }

    if (event.isComposing) {
        // Let native IME composition run unmanaged — fighting it mid-
        // composition breaks the candidate window. Just track the widest
        // range touched so compositionend can widen a re-conversion that
        // reaches back further than where composition started.
        const range = event.getTargetRanges()[0];

        if (range && compositionStart !== null) {
            const start = offsetAt(range.startContainer, range.startOffset);
            const end = offsetAt(range.endContainer, range.endOffset);
            compositionStart = Math.min(compositionStart, start);
            compositionEnd = Math.max(compositionEnd ?? end, end);
        }

        return;
    }

    event.preventDefault();

    const op = opFromBeforeInput(event);

    if (op) {
        applyAndRestoreCaret(op);
    }
}

function onCompositionStart() {
    if (!props.editable) {
        return;
    }

    const selection = window.getSelection();

    if (!selection?.anchorNode) {
        return;
    }

    const offset = offsetAt(selection.anchorNode, selection.anchorOffset);
    compositionStart = offset;
    compositionEnd = offset;
}

function onCompositionEnd(event: CompositionEvent) {
    if (!props.editable || compositionStart === null) {
        return;
    }

    const start = compositionStart;
    const end = compositionEnd ?? start;
    compositionStart = null;
    compositionEnd = null;

    applyAndRestoreCaret({ start, end, text: event.data ?? '' });
}

// The inverse of offsetAt: given a plain-text character offset, find the
// live DOM text node (and offset within it) it currently falls at, skipping
// the same [data-non-text] content offsetAt already excludes.
function pointAt(offset: number): { node: Text; offset: number } | null {
    if (!containerEl.value) {
        return null;
    }

    const walker = document.createTreeWalker(
        containerEl.value,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                return node.parentElement?.closest('[data-non-text]')
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            },
        },
    );

    let remaining = offset;
    let node = walker.nextNode() as Text | null;
    let lastNode: Text | null = null;

    while (node) {
        if (remaining <= node.length) {
            return { node, offset: remaining };
        }

        remaining -= node.length;
        lastNode = node;
        node = walker.nextNode() as Text | null;
    }

    return lastNode ? { node: lastNode, offset: lastNode.length } : null;
}

function restoreCaret(offset: number) {
    const point = pointAt(offset);

    if (!point || !containerEl.value) {
        return;
    }

    containerEl.value.focus();

    const selection = window.getSelection();

    if (!selection) {
        return;
    }

    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}
</script>

<template>
    <span
        ref="containerEl"
        class="cursor-text whitespace-pre-wrap outline-none select-text"
        :class="
            editable &&
            'block min-h-24 rounded border border-stone-300 p-2 dark:border-stone-700'
        "
        :contenteditable="editable"
        @beforeinput="onBeforeInput"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
    >
        <span
            v-if="editable && chunks.length === 0"
            data-non-text
            contenteditable="false"
            class="text-stone-400 dark:text-stone-600"
        >
            Click to start typing…
        </span>
        <template v-for="(chunk, index) in chunks" :key="index">
            <button
                v-if="chunk.segmentStart && chunk.segment"
                type="button"
                data-non-text
                contenteditable="false"
                class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide hover:opacity-80"
                :class="badgeClasses(chunk.segment)"
                :title="badgeTitle(chunk.segment)"
                @click="onBadgeClick(chunk.segment)"
            >
                {{ chunk.segment.canonical_passage?.label }}
            </button>
            <span
                :title="markupTitle(chunk.markup)"
                :class="[
                    ...markupClasses(chunk.markup),
                    !chunk.segment && 'bg-stone-200 dark:bg-stone-700/60',
                    ...regionClasses(chunk.regionId),
                    chunk.selected && 'bg-sky-200/70 dark:bg-sky-800/60',
                ]"
                @pointerenter="
                    chunk.regionId && emit('hover-region', chunk.regionId)
                "
                @pointerleave="chunk.regionId && emit('hover-region', null)"
                >{{ chunk.text }}</span
            >
            <span v-if="chunk.menuAfter" data-non-text class="block w-full">
                <slot name="selection-menu" />
            </span>
        </template>
    </span>
</template>
