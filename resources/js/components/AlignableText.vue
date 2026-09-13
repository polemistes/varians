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
import type { TranscriptionRegion, Assignment } from '@/types/models';

const props = withDefaults(
    defineProps<{
        text: string;
        regions?: TranscriptionRegion[];
        assignments?: Assignment[];
        highlightedRegionId?: number | null;
        editableRegionId?: number | null;
        selectionStart?: number | null;
        selectionEnd?: number | null;
        editable?: boolean;
        // Assignments whose canonical passage is already in some target
        // edition — greyed out instead of the normal assignment-badge
        // treatment. Purely visual (see AddToEditionPanel.vue); rendering
        // doesn't otherwise change what's selectable.
        unavailableAssignmentIds?: number[];
        // How many spans assign each passage (by canonical_passage_id) in the
        // whole layer — so a badge can say "part 1/2" even when the sibling
        // part sits outside the text handed to this component (another page,
        // another window). Absent, it's derived from `assignments`.
        partTotals?: Record<number, number> | null;
        // Where the manuscript's pages begin in this text, drawn as a
        // ruled line with the page's label before the chunk that starts
        // there (the witnesses pane; see TranscriptionPageBreak).
        pageBreaks?: { offset: number; label: string; pageId: number }[];
    }>(),
    {
        regions: () => [],
        assignments: () => [],
        highlightedRegionId: null,
        editableRegionId: null,
        selectionStart: null,
        selectionEnd: null,
        editable: false,
        unavailableAssignmentIds: () => [],
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
    (e: 'badge-click', assignment: Assignment, event: MouseEvent): void;
    // `source` distinguishes a clipboard cut/paste (which the parent may pair
    // into an assignment-preserving relocation) from ordinary typing.
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
    assignment: Assignment | null;
    assignmentStart: boolean;
    selected: boolean;
    pageBreak: { offset: number; label: string; pageId: number } | null;
};

// Region boundaries (image-alignment), assignment-span boundaries, and
// markup-token boundaries (gaps, uncertain readings) are three independent
// dimensions that can partially overlap, so all three are merged into one set
// of cut points. Rendering never changes the underlying characters — only
// wraps them in extra styling spans — so the character offsets region/assignment
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

    const assignments = [...props.assignments]
        .filter(
            (assignment) =>
                assignment.start_offset >= 0 &&
                assignment.end_offset <= textLength,
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

    for (const assignment of assignments) {
        points.add(assignment.start_offset);
        points.add(assignment.end_offset);
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
        const assignment = assignments.find(
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
            assignment: assignment ?? null,
            assignmentStart: assignment
                ? assignment.start_offset === start
                : false,
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

// An assignment's marker stands at its first character and is NOT part of the
// text: it is there to tell a reader which assignment follows. The caret can
// rest on either side of it, and BOTH SIDES MEASURE TO THE SAME OFFSET — so
// which side it stood on is read from the DOM and travels with the edit
// (`side` on the op). Nothing typed, and no caret, ever crosses a marker.
//
// An earlier design asked the editor to say this by clicking a gray slot on
// one side of the marker. It is gone (user decision): the marker should not
// be noticed at all, and the caret already knows which side it is on.
function badgeClasses(chunk: Chunk) {
    const assignment = chunk.assignment;

    if (!chunkLabel(chunk) || !assignment) {
        return [];
    }

    if (assignment.needs_review || assignment.boundary_review) {
        return 'border border-dashed border-red-500 text-red-600 dark:text-red-400';
    }

    if (props.unavailableAssignmentIds.includes(assignment.id)) {
        return 'bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600';
    }

    return 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400';
}

function isMarker(node: Node | null): boolean {
    return (
        node instanceof HTMLElement && node.hasAttribute('data-marker-offset')
    );
}

/**
 * Whether a node stands in the flow without holding any text — Vue's
 * fragment COMMENTS (one sits between every marker and the text before it)
 * and the EMPTY TEXT NODES the browser leaves in an editable surface of its
 * own accord (Chrome parks one beside a chip and at the end of the surface;
 * they appear and disappear as the DOM is patched). Neither is text, so
 * neither may stand between the caret and a marker: a walk that stopped at
 * one reported no marker at all, and what was typed went to the wrong
 * assignment until the next re-render happened to clear the node away. That
 * is the whole shape of "sometimes it works, sometimes it does not" —
 * twice, once for each kind (both found in the browser).
 */
function holdsNoText(node: Node): boolean {
    return (
        node instanceof Comment ||
        (!isMarker(node) && (node.textContent ?? '') === '')
    );
}

/**
 * The nearest node before this one in the surface that holds text, climbing
 * out of wrappers.
 */
function flowPrevious(node: Node): Node | null {
    let at: Node | null = node;

    while (at && at !== containerEl.value) {
        let sibling = at.previousSibling;

        while (sibling && holdsNoText(sibling)) {
            sibling = sibling.previousSibling;
        }

        if (sibling) {
            return sibling;
        }

        at = at.parentNode;
    }

    return null;
}

/** The same the other way. */
function flowNext(node: Node): Node | null {
    let at: Node | null = node;

    while (at && at !== containerEl.value) {
        let sibling = at.nextSibling;

        while (sibling && holdsNoText(sibling)) {
            sibling = sibling.nextSibling;
        }

        if (sibling) {
            return sibling;
        }

        at = at.parentNode;
    }

    return null;
}

/**
 * Which side of an assignment's marker the caret stands on, or null when it is
 * not against one. A marker holds no text, so the offsets on either side of
 * it are EQUAL and only the document order tells them apart — this is the
 * one thing an offset can never say, and everything that went wrong at a
 * marker went wrong for want of it.
 */
function markerSide(): 'before' | 'after' | null {
    const selection = window.getSelection();
    const container = containerEl.value;

    if (
        !selection?.isCollapsed ||
        !selection.anchorNode ||
        !container?.contains(selection.anchorNode)
    ) {
        return null;
    }

    const node = selection.anchorNode;
    const offset = selection.anchorOffset;
    let previous: Node | null;
    let next: Node | null;

    if (node instanceof Text) {
        previous = offset > 0 ? node : flowPrevious(node);
        next = offset < node.data.length ? node : flowNext(node);
    } else {
        // An element-node caret position — how the browser expresses one
        // beside a contenteditable=false chip — indexes CHILD NODES, and
        // the neighbour at that index is as likely to be a comment or an
        // empty text node as the marker itself, so step over those here as
        // well rather than reading the child index raw.
        const before = node.childNodes[offset - 1] ?? null;
        const after = node.childNodes[offset] ?? null;

        previous = before
            ? holdsNoText(before)
                ? flowPrevious(before)
                : before
            : flowPrevious(node);
        next = after
            ? holdsNoText(after)
                ? flowNext(after)
                : after
            : flowNext(node);
    }

    if (isMarker(previous)) {
        return 'after';
    }

    return isMarker(next) ? 'before' : null;
}

/** The label a chunk draws, if it opens an assignment that has one. */
function chunkLabel(chunk: Chunk): string | undefined {
    if (!chunk.assignmentStart || !chunk.assignment) {
        return undefined;
    }

    return badgeText(chunk.assignment) || undefined;
}

/**
 * The tooltip a chunk carries: what its markup means, or — on the chunk that
 * opens an assignment, which is where the label is drawn — what the label says.
 */
function chunkTitle(chunk: Chunk): string | undefined {
    return (
        markupTitle(chunk.markup) ||
        (chunk.assignmentStart && chunk.assignment
            ? badgeTitle(chunk.assignment)
            : undefined)
    );
}

function badgeTitle(assignment: Assignment): string {
    if (assignment.needs_review) {
        return 'The underlying text changed here — please recheck this mapping';
    }

    if (assignment.boundary_review) {
        return 'This assignment begins or ends inside a word, or overlaps another — its bounds have slipped. Select the words again to assign them afresh.';
    }

    if (props.unavailableAssignmentIds.includes(assignment.id)) {
        return 'Already added to the edition';
    }

    const title = assignment.canonical_passage?.work?.title ?? '';

    if (partTotalFor(assignment) > 1) {
        const note = `This passage's text stands in ${partTotalFor(assignment)} separate places in this layer`;

        return title ? `${title} — ${note}` : note;
    }

    return title;
}

// A passage assigned by several spans (its text is physically discontinuous —
// a transposition split it) shows which part of it each span is.
function partTotalFor(assignment: Assignment): number {
    if (props.partTotals) {
        return props.partTotals[assignment.canonical_passage_id] ?? 1;
    }

    return props.assignments.filter(
        (s) => s.canonical_passage_id === assignment.canonical_passage_id,
    ).length;
}

function badgeText(assignment: Assignment): string {
    const label = assignment.canonical_passage?.label ?? '';
    const total = partTotalFor(assignment);

    return total > 1
        ? `${label} · ${assignment.part_ordinal ?? assignment.part}/${total}`
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

/**
 * A caret the browser has put INSIDE a marker is not in the text at all: no
 * caret rectangle is drawn for such a position, so nothing shows the writer
 * where she stands, and the side of the marker — which decides what her
 * typing joins — cannot be read either. Home lands there, the chip being
 * the first thing on a line that an assignment opens (measured in the
 * browser); so does anything else that aims at the very start of such a
 * line.
 *
 * It is stepped out to the marker's FAR side, where the assignment's own
 * words begin: that is what the start of the line means, and it is where
 * the line's first character would go anyway.
 */
function settleCaret(): void {
    const container = containerEl.value;

    if (!props.editable || !container) {
        return;
    }

    if (
        document.activeElement !== container &&
        !container.contains(document.activeElement)
    ) {
        return;
    }

    const selection = window.getSelection();
    const node = selection?.anchorNode;

    if (!selection?.isCollapsed || !node || !container.contains(node)) {
        return;
    }

    const element = node instanceof Element ? node : node.parentElement;
    const marker = element?.closest('[data-marker-offset]');

    if (!marker) {
        return;
    }

    restoreCaret(offsetAt(marker, 0), 'after');
}

function onSelectionChange(): void {
    rememberCaret();
    settleCaret();
}

function onBadgeClick(assignment: Assignment, event: MouseEvent) {
    emit('badge-click', assignment, event);
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
    const onMarker =
        target instanceof Element && target.closest('[data-non-text]') !== null;

    interactionBeganOnText = !onMarker;
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
    document.addEventListener('selectionchange', onSelectionChange);
});
onUnmounted(() => {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('selectionchange', onSelectionChange);
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
        case 'deleteWordBackward':
        case 'deleteSoftLineBackward':
        case 'deleteHardLineBackward':
            return acrossMarker(start, end, -1);
        case 'deleteContentForward':
        case 'deleteWordForward':
        case 'deleteSoftLineForward':
        case 'deleteHardLineForward':
        case 'deleteEntireSoftLine':
            return acrossMarker(start, end, 1);
        case 'deleteByCut':
        case 'deleteByDrag':
            return { start, end, text: '' };
        default:
            return null;
    }
}

/**
 * A deletion the browser could not express as text.
 *
 * An assignment's marker is a real element in the flow and holds no text, so
 * Backspace with the caret just after it targets the MARKER rather than the
 * character before it, and `offsetAt` — which discounts every non-text
 * element — measures that target as empty. The keystroke then deleted
 * nothing at all, which is what made it so hard to run an assigned line onto
 * the line before: the newline standing between them could not be reached
 * from the side the caret naturally sits on (user report).
 *
 * Such a deletion is carried out in MODEL coordinates instead, one character
 * from THE CARET in the direction asked for. The caret, not the empty target
 * range: both sides of a marker measure to the SAME offset, so the range
 * cannot say which side the keystroke came from. Reading it from the range
 * made Delete at the end of a line remove the first letter of the next line
 * instead of the break between them (also reported).
 */
function acrossMarker(
    start: number,
    end: number,
    direction: -1 | 1,
): TextEditOp | null {
    if (start !== end) {
        return { start, end, text: '' };
    }

    const caret = caretOffset() ?? start;

    if (direction === -1) {
        return caret > 0 ? { start: caret - 1, end: caret, text: '' } : null;
    }

    return caret < cpLength(props.text)
        ? { start: caret, end: caret + 1, text: '' }
        : null;
}

/** Where the caret stands in the text, or null when it is not a plain caret. */
function caretOffset(): number | null {
    const selection = window.getSelection();

    if (
        !selection?.isCollapsed ||
        !selection.anchorNode ||
        !containerEl.value?.contains(selection.anchorNode)
    ) {
        return null;
    }

    return offsetAt(selection.anchorNode, selection.anchorOffset);
}

function applyAndRestoreCaret(
    op: TextEditOp,
    source: EditSource = 'typing',
    side: 'before' | 'after' | null = null,
) {
    const targetOffset = op.start + [...op.text].length;

    emit('edit', side === null ? op : { ...op, side }, source);
    // Back to the side it was typed on: a caret never crosses a marker.
    // restoreCaret settles the line-break case by itself.
    void nextTick(() => restoreCaret(targetOffset, side));
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
 * selection includes the assignment badges' visible text ("1.1the quick fox"),
 * so a paste never exactly matched what a cut removed and the
 * assignment-preserving relocation silently failed whenever the selection
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

    stepOverMarker(event);

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

/**
 * An arrow key must always move the caret in the TEXT. A marker holds no
 * text but stands between characters, so the browser stops on each side of
 * it — and crossing from one side to the other moved the caret on screen
 * while leaving it at the same offset. One press appeared to do nothing, and
 * two were needed to move over a single character (user report: "having to
 * press the arrow key twice for the caret to move once is not normal").
 *
 * So a marker's near side is no place to stop, and the caret is stepped over
 * it in whichever direction it arrived. The one exception is where an
 * assignment genuinely ENDS at that offset: two assignments meeting flush have a
 * real position on each side, and an editor must be able to reach both.
 *
 * Read after the browser has moved the caret, since the move happens in the
 * default action this listener runs ahead of.
 */
function stepOverMarker(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
    }

    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }

    const right = event.key === 'ArrowRight';

    window.setTimeout(() => {
        const offset = liveCaretOffset();

        if (offset === null || markerSide() !== 'before') {
            return;
        }

        const ends = (props.assignments ?? []).some(
            (assignment) =>
                assignment.end_offset === offset &&
                assignment.end_offset > assignment.start_offset,
        );

        if (ends) {
            return;
        }

        // Leftward, on past the marker to the character before it; rightward,
        // over to its far side, where the assignment's own words begin.
        restoreCaret(right ? offset : offset - 1, right ? 'after' : null);
    }, 0);
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

    // Read while the caret still stands where the editor put it.
    const side = markerSide();

    event.preventDefault();

    const op = opFromBeforeInput(event);

    if (op) {
        const source = editSourceOf(event.inputType);

        applyAndRestoreCaret(
            // Arriving text stays unassigned; typing is held to assigning what it
            // lands among. See SpanTransformer::claimant.
            source === 'paste' ? { ...op, imported: true } : op,
            source,
            op.start === op.end ? side : null,
        );
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
function pointAt(
    offset: number,
    side: 'before' | 'after' | null = null,
): { node: Text; offset: number } | null {
    if (!containerEl.value) {
        return null;
    }

    offset = Math.max(0, offset);

    const walker = document.createTreeWalker(
        containerEl.value,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                // Empty text nodes are skipped along with the non-text
                // elements: the browser leaves them beside a chip and at the
                // end of the surface of its own accord, and a caret put in
                // one is a caret standing next to a marker with no way to
                // say which side it is on.
                return node.parentElement?.closest('[data-non-text]') ||
                    node.textContent === ''
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

        // An offset at the very end of one text node is the same offset as
        // the start of the next, and a marker may stand between them. Coming
        // from the marker's far side, walk on to the later node so the caret
        // is put back where it was rather than across the marker.
        if (
            remaining < codePoints.length ||
            (remaining === codePoints.length && side !== 'after')
        ) {
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

function restoreCaret(offset: number, side: 'before' | 'after' | null = null) {
    // A caret just past a LINE BREAK belongs on the new line. The position at
    // the end of a text node and the one at the start of the next are the
    // same offset, and the browser draws the former at the end of the OLD
    // line — so Enter left the caret behind, and Delete then took the first
    // character of the next line rather than the break (both reported).
    //
    // Read from the TEXT, not the DOM: chunks merge and split between
    // renders, so which node the caret happens to sit in says nothing
    // durable, and a DOM-derived answer was lost on the very next patch.
    const afterBreak =
        offset > 0 && cpSlice(props.text, offset - 1, offset) === '\n';
    const point = pointAt(offset, side ?? (afterBreak ? 'after' : null));

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
let caretBeforePatch: {
    offset: number;
    side: 'before' | 'after' | null;
} | null = null;

onBeforeUpdate(() => {
    caretBeforePatch = liveCaretPlace();
});

onUpdated(() => {
    if (caretBeforePatch === null) {
        return;
    }

    const { offset, side } = caretBeforePatch;
    caretBeforePatch = null;

    if (liveCaretOffset() !== offset) {
        // WITH its side. One offset can be two places — after a line break
        // or across a marker — and putting it back without saying which
        // undid the landing an edit had just chosen: the caret slid back up
        // to the end of the old line on the next re-render (real bug, and
        // why Enter appeared to leave the caret behind).
        restoreCaret(offset, side);
    }
});

/**
 * Where the caret is, and which side of a MARKER it stands on if it stands
 * at one. Only the marker side is worth carrying across a patch: the
 * line-break case restoreCaret derives from the text, which survives the
 * chunks being regrouped.
 */
function liveCaretPlace(): {
    offset: number;
    side: 'before' | 'after' | null;
} | null {
    const offset = liveCaretOffset();

    return offset === null ? null : { offset, side: markerSide() };
}

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
            <span
                v-if="chunkLabel(chunk) && chunk.assignment"
                data-non-text
                contenteditable="false"
                class="mx-1 cursor-pointer rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide select-none"
                :class="badgeClasses(chunk)"
                :data-assignment-id="chunk.assignment.id"
                :data-marker-offset="chunk.assignment.start_offset"
                :title="badgeTitle(chunk.assignment)"
                @mousedown.prevent="onBadgeClick(chunk.assignment, $event)"
                >{{ chunkLabel(chunk) }}</span
            >
            <span
                :title="chunkTitle(chunk)"
                :class="[
                    ...markupClasses(chunk.markup),
                    !chunk.assignment && 'bg-stone-200 dark:bg-stone-700/60',
                    chunk.assignment &&
                        unavailableAssignmentIds.includes(
                            chunk.assignment.id,
                        ) &&
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
