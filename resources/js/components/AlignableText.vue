<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { EditSource, TextEditOp } from '@/lib/transcriptionEdit';
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
        // How many spans cite each passage (by canonical_passage_id) in the
        // whole layer — so a badge can say "part 1/2" even when the sibling
        // part sits outside the text handed to this component (another page,
        // another window). Absent, it's derived from `segments`.
        partTotals?: Record<number, number> | null;
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
        partTotals: null,
    },
);

const emit = defineEmits<{
    (
        e: 'select',
        selection: { start: number; end: number; text: string },
    ): void;
    (e: 'hover-region', id: number | null): void;
    (e: 'badge-click', segment: TranscriptionSegment): void;
    // `source` distinguishes a clipboard cut/paste (which the parent may pair
    // into a citation-preserving relocation) from ordinary typing.
    (e: 'edit', op: TextEditOp, source: EditSource): void;
    (e: 'undo'): void;
    (e: 'redo'): void;
    // The user collapsed the selection (clicked in the text) — whatever
    // selection the parent remembered no longer reflects what's on screen.
    (e: 'selection-cleared'): void;
    /** A copy took these characters — offsets in this component's text. */
    (e: 'copied', copy: { start: number; end: number; text: string }): void;
}>();

const containerEl = ref<HTMLElement | null>(null);

type Chunk = {
    text: string;
    regionId: number | null;
    markup: Exclude<MarkupToken, { type: 'text' }> | null;
    segment: TranscriptionSegment | null;
    segmentStart: boolean;
    selected: boolean;
    // Zero-width (tombstoned) citation spans sitting exactly at this chunk's
    // start — destroyed by a text edit, kept flagged for the editor to
    // resolve. They cover no characters, so they render as badge-only.
    tombstonesBefore: TranscriptionSegment[];
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

    // A tombstone's offset must be a chunk boundary so its badge has an
    // exact place in the text flow to render at.
    const tombstones = segments.filter(
        (segment) => segment.start_offset === segment.end_offset,
    );

    for (const tombstone of tombstones) {
        points.add(tombstone.start_offset);
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
            (s) =>
                s.start_offset <= start &&
                s.end_offset >= end &&
                s.end_offset > s.start_offset,
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
            tombstonesBefore: tombstones.filter(
                (tombstone) => tombstone.start_offset === start,
            ),
        });
    }

    return result;
});

// Tombstones at the very end of the text have no following chunk to attach
// to, so they render after the last one.
const trailingTombstones = computed<TranscriptionSegment[]>(() =>
    props.segments.filter(
        (segment) =>
            segment.start_offset === segment.end_offset &&
            segment.start_offset >= props.text.length,
    ),
);

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

    const title = segment.canonical_passage?.work?.title ?? '';

    if (partTotalFor(segment) > 1) {
        const note = `This passage's text stands in ${partTotalFor(segment)} separate places in this layer`;

        return title ? `${title} — ${note}` : note;
    }

    return title;
}

// A passage cited by several spans (its text is physically discontinuous —
// a transposition split it) shows which part of it each span is.
function partTotalFor(segment: TranscriptionSegment): number {
    if (props.partTotals) {
        return props.partTotals[segment.canonical_passage_id] ?? 1;
    }

    return props.segments.filter(
        (s) => s.canonical_passage_id === segment.canonical_passage_id,
    ).length;
}

function badgeText(segment: TranscriptionSegment): string {
    const label = segment.canonical_passage?.label ?? '';
    const total = partTotalFor(segment);

    return total > 1
        ? `${label} · ${segment.part_ordinal ?? segment.part}/${total}`
        : label;
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
/**
 * Where the caret last was in this text.
 *
 * Remembered rather than read on demand, because whatever needs it is
 * typically a control the writer has just clicked — a file picker, say — and
 * clicking it moves focus out of the text, taking the live selection with it.
 * A collapsed selection is ignored by the `select` handler above, since it is
 * not a span to align or cite, but an insertion needs exactly that.
 */
const lastCaret = ref<number | null>(null);

function rememberCaret(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || !containerEl.value) {
        return;
    }

    const node = selection.focusNode;

    if (node === null || !containerEl.value.contains(node)) {
        return;
    }

    lastCaret.value = offsetAt(node, selection.focusOffset);
}

defineExpose({
    caretOffset: () => lastCaret.value,
    // Lets the parent restore the caret after applying ops of its own
    // making (undo/redo), which never pass through applyAndRestoreCaret.
    restoreCaretAt: (offset: number) => restoreCaret(offset),
    // Sets the live selection to a range — the parent uses this after a
    // badge click, so the floating selection actions have a real selection
    // rectangle to anchor under.
    selectRangeAt: (start: number, end: number) => {
        const from = pointAt(start);
        const to = pointAt(end);
        const selection = window.getSelection();

        if (!from || !to || !selection) {
            return;
        }

        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        selection.removeAllRanges();
        selection.addRange(range);
    },
});

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
    emit('badge-click', segment);
}

/**
 * Whether the current mouse interaction BEGAN on the text itself (as
 * opposed to on a badge, a menu control, or outside the component). This is
 * what decides dismissal of a remembered selection — but the decision is
 * only EXECUTED at mouseup: clearing state at mousedown re-renders the
 * chunks and destroys the DOM under an in-progress drag, which broke every
 * selection made after the first (real bug). And mouseup position alone
 * can never decide, because a native <select> popup releases its closing
 * mouseup at the pointer's position on the page UNDERNEATH the popup —
 * over the text — which dismissed the assign menu mid-use (also a real
 * bug). Origin at mousedown, action at mouseup.
 */
let interactionBeganOnText = false;

function onContainerMousedown(event: MouseEvent) {
    if (!props.editable) {
        return;
    }

    const target = event.target;

    interactionBeganOnText = !(
        target instanceof Element && target.closest('[data-non-text]') !== null
    );
}

function onMouseUp() {
    const beganOnText = interactionBeganOnText;
    interactionBeganOnText = false;

    const selection = window.getSelection();

    if (!selection || !containerEl.value) {
        return;
    }

    // While editable, BOTH outcomes of a mouseup — reporting a selection and
    // clearing one — require that the interaction began on the text. The
    // live selection is preserved after release now, so any stray mouseup
    // (a toolbar click, a native <select> popup releasing over the page)
    // would otherwise find that still-valid selection and re-emit it as if
    // freshly made — which closed the menu the editor had just opened for
    // it (real bug, the second one caused by that popup's mouseup).
    if (props.editable && !beganOnText) {
        return;
    }

    if (
        selection.isCollapsed ||
        !selection.anchorNode ||
        !selection.focusNode
    ) {
        // The interaction started on the text and produced no selection — a
        // plain click into it, placing the caret. Only now, with the drag
        // definitely over, is it safe to dismiss what was remembered.
        if (props.editable && beganOnText) {
            emit('selection-cleared');
        }

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
        if (props.editable && beganOnText) {
            emit('selection-cleared');
        }

        return;
    }

    emit('select', { start, end, text: props.text.slice(start, end) });

    // While editable, the selection stays live — it is normal editor
    // selection (type over it, cut it) that the parent merely remembers for
    // the assign/align buttons. Read-only consumers keep the old behavior:
    // the selection's job is done once it's emitted.
    if (!props.editable) {
        selection.removeAllRanges();
    }
}

// Listening on `document` rather than on this (inline, tightly-wrapped)
// container is deliberate: a drag that ends in the sliver of space just past
// the last character of a line can release the pointer outside this span's
// own box (onto its parent), where a listener scoped to the span would never
// see the event. `contains()` above already filters to selections that
// belong to this component, so listening globally is exactly as precise.
onMounted(() => {
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', rememberCaret);
});
onUnmounted(() => {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('selectionchange', rememberCaret);
});

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

function applyAndRestoreCaret(op: TextEditOp, source: EditSource = 'typing') {
    const targetOffset = op.start + [...op.text].length;

    emit('edit', op, source);
    void nextTick(() => restoreCaret(targetOffset));
}

// beforeinput (and composition events) bubble — the badges and tombstone
// buttons nested in the surface fire them too, and intercepting those would
// swallow interactions that belong to a control, not to the text. Every
// non-text element carries [data-non-text], so the composed path tells the
// two apart. (This once also guarded a #selection-menu slot; menus now
// always render outside the text surface.)
function originatesInControl(event: Event): boolean {
    return event
        .composedPath()
        .some(
            (target) =>
                target instanceof HTMLElement &&
                target !== containerEl.value &&
                target.hasAttribute('data-non-text'),
        );
}

function editSourceOf(inputType: string): EditSource {
    if (inputType === 'deleteByCut' || inputType === 'deleteByDrag') {
        return 'cut';
    }

    if (
        inputType === 'insertFromPaste' ||
        inputType === 'insertFromPasteAsQuotation' ||
        inputType === 'insertFromDrop'
    ) {
        return 'paste';
    }

    return 'typing';
}

/**
 * Copy and cut own the clipboard: the browser's own serialization of a
 * selection includes the citation badges' visible text ("1.1the quick fox"),
 * so a paste never exactly matched what a cut removed and the
 * citation-preserving relocation silently failed whenever the selection
 * covered a badge (real bug). Both handlers put the PURE text — the same
 * characters the offsets describe — on the clipboard; cut additionally
 * performs the deletion as an ordinary tagged edit op (preventing the event
 * means the browser does neither, and no deleteByCut beforeinput follows).
 */
function selectionOffsets(): { start: number; end: number } | null {
    const selection = window.getSelection();

    if (
        !selection ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !selection.focusNode ||
        !containerEl.value ||
        !containerEl.value.contains(selection.anchorNode) ||
        !containerEl.value.contains(selection.focusNode)
    ) {
        return null;
    }

    const a = offsetAt(selection.anchorNode, selection.anchorOffset);
    const b = offsetAt(selection.focusNode, selection.focusOffset);
    const [start, end] = a < b ? [a, b] : [b, a];

    return end - start < 1 ? null : { start, end };
}

function onCopy(event: ClipboardEvent) {
    if (!props.editable || originatesInControl(event)) {
        return;
    }

    const offsets = selectionOffsets();

    if (!offsets || !event.clipboardData) {
        return;
    }

    event.preventDefault();
    const text = props.text.slice(offsets.start, offsets.end);
    event.clipboardData.setData('text/plain', text);
    // So a paste into a SIBLING layer can bring the spans along.
    emit('copied', { start: offsets.start, end: offsets.end, text });
}

function onCut(event: ClipboardEvent) {
    if (!props.editable || originatesInControl(event)) {
        return;
    }

    const offsets = selectionOffsets();

    if (!offsets || !event.clipboardData) {
        return;
    }

    event.preventDefault();
    event.clipboardData.setData(
        'text/plain',
        props.text.slice(offsets.start, offsets.end),
    );
    applyAndRestoreCaret(
        { start: offsets.start, end: offsets.end, text: '' },
        'cut',
    );
}

/**
 * Undo/redo shortcuts are caught at the KEYBOARD, not via the
 * `historyUndo`/`historyRedo` beforeinput types: browsers only fire those
 * when their own native undo stack is non-empty, and this editor prevents
 * every native mutation, so the native stack is permanently empty and
 * Ctrl+Z never produced an event at all (real bug). The beforeinput cases
 * below stay as a harmless fallback for any UI path that does fire them.
 */
function onContainerKeydown(event: KeyboardEvent) {
    if (!props.editable || originatesInControl(event)) {
        return;
    }

    const modifier = event.ctrlKey || event.metaKey;

    if (!modifier || event.altKey) {
        return;
    }

    const key = event.key.toLowerCase();

    if (key === 'z') {
        event.preventDefault();

        if (event.shiftKey) {
            emit('redo');
        } else {
            emit('undo');
        }

        return;
    }

    if (key === 'y' && !event.shiftKey) {
        event.preventDefault();
        emit('redo');
    }
}

function onBeforeInput(event: InputEvent) {
    if (!props.editable || originatesInControl(event)) {
        return;
    }

    if (event.inputType === 'historyUndo') {
        event.preventDefault();
        emit('undo');

        return;
    }

    if (event.inputType === 'historyRedo') {
        event.preventDefault();
        emit('redo');

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
        applyAndRestoreCaret(op, editSourceOf(event.inputType));
    }
}

function onCompositionStart(event: CompositionEvent) {
    if (!props.editable || originatesInControl(event)) {
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
    if (
        !props.editable ||
        originatesInControl(event) ||
        compositionStart === null
    ) {
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
        :contenteditable="editable ? 'true' : undefined"
        @mousedown="onContainerMousedown"
        @keydown="onContainerKeydown"
        @copy="onCopy"
        @cut="onCut"
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
                v-for="tombstone in chunk.tombstonesBefore"
                :key="`tombstone-${tombstone.id}`"
                type="button"
                data-non-text
                contenteditable="false"
                class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide hover:opacity-80"
                :class="badgeClasses(tombstone)"
                :title="'This citation\'s text was deleted — reselect its span or remove it'"
                @mousedown.prevent
                @click="onBadgeClick(tombstone)"
            >
                {{ badgeText(tombstone) }}
            </button>
            <button
                v-if="chunk.segmentStart && chunk.segment"
                type="button"
                data-non-text
                contenteditable="false"
                class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide hover:opacity-80"
                :class="badgeClasses(chunk.segment)"
                :title="badgeTitle(chunk.segment)"
                @mousedown.prevent
                @click="onBadgeClick(chunk.segment)"
            >
                {{ badgeText(chunk.segment) }}
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
        </template>
        <button
            v-for="tombstone in trailingTombstones"
            :key="`trailing-tombstone-${tombstone.id}`"
            type="button"
            data-non-text
            contenteditable="false"
            class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide hover:opacity-80"
            :class="badgeClasses(tombstone)"
            :title="'This citation\'s text was deleted — reselect its span or remove it'"
            @mousedown.prevent
            @click="onBadgeClick(tombstone)"
        >
            {{ badgeText(tombstone) }}
        </button>
    </span>
</template>
