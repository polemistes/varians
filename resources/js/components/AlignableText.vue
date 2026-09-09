<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUpdate,
    onMounted,
    onUnmounted,
    onUpdated,
    ref,
} from 'vue';
import { cpLength, cpSlice } from '@/lib/codePoints';
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
        // Where the manuscript's pages begin in this text, drawn as a
        // ruled line with the page's label before the chunk that starts
        // there (the witnesses pane; see TranscriptionPageBreak).
        pageBreaks?: { offset: number; label: string; pageId: number }[];
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
        pageBreaks: () => [],
    },
);

const emit = defineEmits<{
    (
        e: 'select',
        selection: { start: number; end: number; text: string },
    ): void;
    (e: 'hover-region', id: number | null): void;
    (e: 'badge-click', segment: TranscriptionSegment, event: MouseEvent): void;
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
    pageBreak: { offset: number; label: string; pageId: number } | null;
};

// Region boundaries (image-alignment), citation-span boundaries, and
// markup-token boundaries (gaps, uncertain readings) are three independent
// dimensions that can partially overlap, so all three are merged into one set
// of cut points. Rendering never changes the underlying characters — only
// wraps them in extra styling spans — so the character offsets region/segment
// selection relies on stay valid no matter what markup exists.
// Offsets count code points, like every stored span (see lib/codePoints):
// the text's UTF-16 length and slices must not meet them directly.
const chunks = computed<Chunk[]>(() => {
    const textLength = cpLength(props.text);
    const regions = [...props.regions]
        .filter(
            (region) =>
                region.start_offset >= 0 && region.end_offset <= textLength,
        )
        .sort((a, b) => a.start_offset - b.start_offset);

    const segments = [...props.segments]
        .filter(
            (segment) =>
                segment.start_offset >= 0 && segment.end_offset <= textLength,
        )
        .sort((a, b) => a.start_offset - b.start_offset);

    const markupSpans = parseTranscriptionMarkup(props.text).filter(
        (token) => token.type !== 'text',
    ) as Exclude<MarkupToken, { type: 'text' }>[];

    const points = new Set<number>([0, textLength]);

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

    for (const pageBreak of props.pageBreaks) {
        if (pageBreak.offset >= 0 && pageBreak.offset < textLength) {
            points.add(pageBreak.offset);
        }
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
            text: cpSlice(props.text, start, end),
            regionId: region ? region.id : null,
            markup: markup ?? null,
            segment: segment ?? null,
            segmentStart: segment ? segment.start_offset === start : false,
            pageBreak:
                props.pageBreaks.find((item) => item.offset === start) ?? null,
            selected:
                props.selectionStart !== null &&
                props.selectionEnd !== null &&
                start >= props.selectionStart &&
                end <= props.selectionEnd,
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
    if (segment.needs_review || segment.boundary_review) {
        return 'border border-dashed border-red-500 text-red-600 dark:text-red-400';
    }

    if (props.unavailableSegmentIds.includes(segment.id)) {
        return 'bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600';
    }

    return 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400';
}

function badgeTitle(segment: TranscriptionSegment): string {
    if (segment.needs_review) {
        return 'The underlying text changed here — please recheck this mapping';
    }

    if (segment.boundary_review) {
        return 'This citation begins or ends inside a word, or overlaps another — its bounds have slipped. Select the words again to re-cite them.';
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

    let length = cpLength(range.toString());

    for (const el of range
        .cloneContents()
        .querySelectorAll('[data-non-text]')) {
        length -= cpLength(el.textContent ?? '');
    }

    return length;
}

function onBadgeClick(segment: TranscriptionSegment, event: MouseEvent) {
    emit('badge-click', segment, event);
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

    emit('select', { start, end, text: cpSlice(props.text, start, end) });

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
// A composition (an IME, or the dead keys that make accented Greek) runs
// unmanaged in the DOM: the browser inserts and replaces its own
// provisional text there while the model text stays as it was. So an
// offset measured against the DOM during composition counts those
// provisional characters, and using it as the END of the replaced range
// ate the character after the caret every time a diacritic was typed
// (real bug). The range the composition replaces in MODEL coordinates is
// what the selection covered when it began, widened only by EXISTING text
// a later step reaches into — never by the composition's own characters.
let compositionStart: number | null = null;
let compositionEnd: number | null = null;
let composedLength = 0;

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

// beforeinput (and composition events) bubble — the badges
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
    const text = cpSlice(props.text, offsets.start, offsets.end);
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
        cpSlice(props.text, offsets.start, offsets.end),
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
        // Let native composition run unmanaged — fighting it mid-
        // composition breaks the candidate window. Track only the EXISTING
        // text a step replaces: the target range spans the provisional
        // text so far (composedLength) plus whatever real text it reaches
        // into, and only the latter widens the model range.
        const range = event.getTargetRanges()[0];

        if (range && compositionStart !== null) {
            const start = offsetAt(range.startContainer, range.startOffset);
            const end = offsetAt(range.endContainer, range.endOffset);
            const existing = Math.max(0, end - start - composedLength);

            compositionStart = Math.min(compositionStart, start);
            compositionEnd = Math.max(
                compositionEnd ?? compositionStart,
                Math.min(start, compositionStart) + existing,
            );
        }

        if (event.inputType === 'insertCompositionText') {
            composedLength = [...(event.data ?? '')].length;
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

    // The selection when composition begins is the existing text the
    // composition replaces — usually nothing but the caret.
    const anchor = offsetAt(selection.anchorNode, selection.anchorOffset);
    const focus = selection.focusNode
        ? offsetAt(selection.focusNode, selection.focusOffset)
        : anchor;
    compositionStart = Math.min(anchor, focus);
    compositionEnd = Math.max(anchor, focus);
    composedLength = 0;
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
    const end = Math.max(start, compositionEnd ?? start);
    compositionStart = null;
    compositionEnd = null;
    composedLength = 0;

    applyAndRestoreCaret({ start, end, text: event.data ?? '' });
}

// The inverse of offsetAt: given a plain-text code point offset, find the
// live DOM text node (and UTF-16 offset within it — what Range wants) it
// currently falls at, skipping the same [data-non-text] content offsetAt
// already excludes. A negative offset (a stale page-relative caret) clamps
// to the start rather than throwing an IndexSizeError from setStart.
function pointAt(offset: number): { node: Text; offset: number } | null {
    if (!containerEl.value) {
        return null;
    }

    offset = Math.max(0, offset);

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
        const codePoints = [...node.data];

        if (remaining <= codePoints.length) {
            return {
                node,
                offset: codePoints.slice(0, remaining).join('').length,
            };
        }

        remaining -= codePoints.length;
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

// Chunks are freshly re-rendered spans with no stable per-character DOM
// identity, so ANY re-render can replace the text node holding the caret —
// and Firefox dumps a caret whose node vanished to the start of the surface
// (the writer saw every Enter jump to an earlier line one autosave later:
// the partial reload's patch regrouped the lines' nodes). The character
// offset is still right after a patch — a prop-driven one doesn't change
// the text the writer sees, and an edit-driven one is followed by
// applyAndRestoreCaret's own nextTick restore, which runs after onUpdated
// and wins. So: capture the live caret just before every patch, and put it
// back if the patch displaced it.
let caretBeforePatch: number | null = null;

onBeforeUpdate(() => {
    caretBeforePatch = liveCaretOffset();
});

onUpdated(() => {
    if (caretBeforePatch === null) {
        return;
    }

    const offset = caretBeforePatch;
    caretBeforePatch = null;

    if (liveCaretOffset() !== offset) {
        restoreCaret(offset);
    }
});

/**
 * The collapsed caret's character offset — only while the writer is focused
 * here (restoring focuses the surface, and a background pane's re-render
 * must never steal the caret) and only for a caret, not a range selection
 * (clobbered live selections have their own remembered-selection machinery).
 */
function liveCaretOffset(): number | null {
    if (
        !containerEl.value ||
        (document.activeElement !== containerEl.value &&
            !containerEl.value.contains(document.activeElement))
    ) {
        return null;
    }

    const selection = window.getSelection();
    const node = selection?.focusNode;

    if (
        !selection ||
        !selection.isCollapsed ||
        !node ||
        !containerEl.value.contains(node)
    ) {
        return null;
    }

    return offsetAt(node, selection.focusOffset);
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
            <span
                v-if="chunk.pageBreak"
                data-non-text
                contenteditable="false"
                class="my-1 flex items-center gap-2 font-sans text-xs text-stone-500 select-none dark:text-stone-400"
                :data-page-id="chunk.pageBreak.pageId"
                :data-page-offset="chunk.pageBreak.offset"
                ><span class="h-px flex-1 bg-stone-300 dark:bg-stone-700"></span
                >{{ chunk.pageBreak.label
                }}<span
                    class="h-px flex-1 bg-stone-300 dark:bg-stone-700"
                ></span
            ></span>
            <button
                v-if="chunk.segmentStart && chunk.segment"
                type="button"
                data-non-text
                contenteditable="false"
                class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide hover:opacity-80"
                :class="badgeClasses(chunk.segment)"
                :title="badgeTitle(chunk.segment)"
                @mousedown.prevent
                @click="onBadgeClick(chunk.segment, $event)"
            >
                {{ badgeText(chunk.segment) }}
            </button>
            <span
                :title="markupTitle(chunk.markup)"
                :class="[
                    ...markupClasses(chunk.markup),
                    !chunk.segment && 'bg-stone-200 dark:bg-stone-700/60',
                    chunk.segment &&
                        unavailableSegmentIds.includes(chunk.segment.id) &&
                        'text-stone-400 dark:text-stone-600',
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
    </span>
</template>
