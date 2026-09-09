<script setup lang="ts">
import { Head, Link, router, useForm } from '@inertiajs/vue3';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import ConjectureForm from '@/components/ConjectureForm.vue';
import ReferencePicker from '@/components/ReferencePicker.vue';
import WitnessesPanel from '@/components/WitnessesPanel.vue';
import type { WitnessTranscript } from '@/components/WitnessesPanel.vue';
import {
    candidateSummary,
    candidateText,
    conjectureCandidates,
    differenceProvenance,
    discontinuityLines,
    discontinuityTitle,
    manuscriptReadings,
    sameReading,
    witnessReadings,
} from '@/lib/apparatus';
import type { BiblatexRegistry, Suggestions } from '@/lib/biblatex';
import { confirmDeletion } from '@/lib/deletionImpact';
import { analyzeSequence } from '@/lib/orderReport';
import { store as storeConjectureOrdering } from '@/routes/conjecture-orderings';
import { store as storeEditionAdoption } from '@/routes/edition-adoptions';
import {
    destroy as destroyComment,
    store as storeComment,
    update as updateComment,
} from '@/routes/edition-comments';
import {
    destroy as destroyEditor,
    store as storeEditor,
} from '@/routes/edition-editors';
import { destroy as destroyEditionLemma } from '@/routes/edition-lemmas';
import { update as updateLineBreak } from '@/routes/edition-line-breaks';
import { apply as applyEditionOrder } from '@/routes/edition-order';
import { store as storeTransfer } from '@/routes/edition-ownership-transfers';
import { destroy as destroyEditionPassage } from '@/routes/edition-passages';
import { update as updatePassageLineation } from '@/routes/edition-passages/lineation';
import { store as storeVariant } from '@/routes/edition-variants';
import { copy as copyEditionRoute } from '@/routes/editions';
import {
    destroy as destroyEdition,
    show as showEdition,
    update as updateEdition,
} from '@/routes/editions';
import { exportMethod as exportEditionBibliography } from '@/routes/editions/bibliography';
import { destroy as destroyTransfer } from '@/routes/ownership-transfers';
import { show as showWitness } from '@/routes/witnesses';
import type { WorkConjecture, WorkPassage } from '@/types/conjectures';
import type {
    BibliographyEntry,
    Candidate,
    DiscontinuousWitness,
    DraftReference,
    EditionComment,
    OrderCandidate,
    OrderRange,
    PassageListItem,
    Run,
    TranscriptionOption,
    TranspositionAdoption,
    UnplacedConjecture,
    WindowPassage,
    EditionAbilities,
    EditionAccess,
} from '@/types/edition';
import type { Edition, ReferenceLevel, Visibility, Work } from '@/types/models';

const props = defineProps<{
    work: Pick<Work, 'id' | 'title' | 'slug'>;
    edition: Edition;
    can: EditionAbilities;
    access: EditionAccess;
    page: number;
    totalPages: number;
    passages: PassageListItem[];
    windowPassages: WindowPassage[];
    transpositions: TranspositionAdoption[];
    transcriptions: TranscriptionOption[];
    workPassages: WorkPassage[];
    /** The work's conjectures as the Work page lists them — see ConjectureCatalogue. */
    workConjectures: WorkConjecture[];
    referenceLevels: ReferenceLevel[];
    witnessTranscripts: WitnessTranscript[];
    /** Every item this edition's passages and conjectures cite, formatted. */
    bibliography: BibliographyEntry[];
    /** What the references picker needs to create an item in place. */
    bibliographyForm: { registry: BiblatexRegistry; suggestions: Suggestions };
    /** Every visible witness citing the work, whether or not this edition uses it yet. */
    witnesses: {
        id: number;
        siglum: string;
        label: string | null;
        in_edition: boolean;
    }[];
}>();

function draftReferencesPayload(references: DraftReference[]) {
    return references.map((reference) => ({
        item_id: reference.item_id,
        prenote: reference.prenote || null,
        postnote: reference.postnote || null,
    }));
}

// Every canonical passage already in this edition, from any transcription —
// used by the add-to-edition panel to grey out what's already claimed.
const alreadyAddedPassageIds = computed(() =>
    props.passages.map((passage) => passage.id),
);

// What the server's policies allow this viewer — the page only reflects it.
const mayEdit = computed(() => props.can.edit);

// An editor can stand where a reader stands. Everything that edits is gated
// on `canEdit`, so switching this off gives the reader's own view — no
// editing panels or markers, though the derived notices on the line numbers
// (order, splits, notes) stay readable — without needing a second account
// to check the work in.
const readerView = ref(false);
const canEdit = computed(() => mayEdit.value && !readerView.value);

function goToPage(targetPage: number) {
    router.visit(
        showEdition.url([props.work, props.edition], {
            query: { page: targetPage },
        }),
    );
}

// ---- go to line: a long edition is many pages of fifty, and "line 412"
// should be one keystroke away, not eight Nexts.
const jumpLabel = ref('');
const jumpError = ref<string | null>(null);

function jumpToPassage() {
    const label = jumpLabel.value.trim();
    const target = props.passages.find((passage) => passage.label === label);

    if (!target) {
        jumpError.value = label ? `No line ${label} in this edition.` : null;

        return;
    }

    jumpError.value = null;
    const scroll = () =>
        document
            .getElementById(`passage-${target.id}`)
            ?.scrollIntoView({ block: 'center' });

    if (target.page === props.page) {
        scroll();

        return;
    }

    router.visit(
        showEdition.url([props.work, props.edition], {
            query: { page: target.page },
        }),
        { onSuccess: () => void nextTick(scroll) },
    );
}

// ---- edition header: title/description/visibility ----
const editingHeader = ref(false);
const headerForm = useForm({
    title: props.edition.title,
    description: props.edition.description ?? '',
    visibility: props.edition.visibility,
});

function saveHeader() {
    headerForm.patch(updateEdition.url(props.edition), {
        preserveScroll: true,
        onSuccess: () => {
            editingHeader.value = false;
        },
    });
}

function saveVisibility(visibility: Visibility) {
    router.patch(
        updateEdition.url(props.edition),
        { visibility },
        { preserveScroll: true },
    );
}

// ---- access: who owns the edition, who else may edit it, handing it on ----
const editorForm = useForm({ email: '' });

function grantEditor() {
    editorForm.post(storeEditor.url(props.edition), {
        preserveScroll: true,
        onSuccess: () => editorForm.reset(),
    });
}

function revokeEditor(userId: number) {
    router.delete(destroyEditor.url({ edition: props.edition, user: userId }), {
        preserveScroll: true,
    });
}

const transferForm = useForm({ email: '' });

function offerOwnership() {
    transferForm.post(storeTransfer.url(props.edition), {
        preserveScroll: true,
        onSuccess: () => transferForm.reset(),
    });
}

function withdrawOffer(transferId: number) {
    router.delete(destroyTransfer.url(transferId), { preserveScroll: true });
}

function copyEdition() {
    if (
        !window.confirm(
            'Make your own copy of this edition? You get a copy of the work, of every witness citing it, and of every conjecture recorded against it — all yours to edit, none of it shared with the original.',
        )
    ) {
        return;
    }

    router.post(copyEditionRoute.url(props.edition));
}

function removeEdition() {
    // Every other delete in the app asks first; this one deleted on a
    // single click (real slip waiting to happen).
    if (!confirmDeletion(`the edition "${props.edition.title}"`, [])) {
        return;
    }

    router.delete(destroyEdition.url(props.edition));
}

// ---- the continuous text: select a span (any number of words — a single
// click is just a range of one) to author a brand new conjecture over it;
// click a run already marked as having something to decide — disagreement,
// an already-adopted choice, or coverage by another run's not-yet-adopted
// wider candidate — to choose among its candidates; click a boundary dot to
// insert a lacuna. Clicking anywhere else does nothing. ----
type OpenTarget =
    | { passageId: number; kind: 'run'; index: number }
    | { passageId: number; kind: 'boundary'; index: number }
    | {
          passageId: number;
          kind: 'new_passage';
          afterEditionPassageId: number | null;
      }
    | {
          passageId: number;
          kind: 'range';
          startIndex: number;
          endIndex: number;
      }
    | { passageId: number; kind: 'remove'; passageIds: number[] }
    | { passageId: number; kind: 'line' };

const openTarget = ref<OpenTarget | null>(null);
const submitError = ref<string | null>(null);

// ---- editorial notes ----
// Which passage has its note composer open, which note is being reworded,
// and the text in hand. A note is anchored to whatever run is currently
// open, if any, so writing about one word needs no separate gesture.
const notingPassageId = ref<number | null>(null);
const editingNoteId = ref<number | null>(null);
const noteDraft = ref('');

function openNoteComposer(passage: WindowPassage) {
    notingPassageId.value = passage.id;
    editingNoteId.value = null;
    noteDraft.value = '';
}

function startEditingNote(comment: EditionComment) {
    editingNoteId.value = comment.id;
    noteDraft.value = comment.note;
}

function cancelNote() {
    notingPassageId.value = null;
    editingNoteId.value = null;
    noteDraft.value = '';
}

/**
 * The columns a new note will be pinned to, or nulls for a note about the
 * passage as a whole. Follows whichever run or range is open, so writing
 * about one word needs no separate gesture.
 */
function noteAnchor(passage: WindowPassage): {
    lemma_id: number | null;
    range_end_lemma_id: number | null;
} {
    const unanchored = { lemma_id: null, range_end_lemma_id: null };
    const target = openTarget.value;

    if (target === null || target.passageId !== passage.id) {
        return unanchored;
    }

    if (target.kind === 'range') {
        const startRun = passage.runs[target.startIndex];
        const endRun = passage.runs[target.endIndex];

        return startRun && endRun
            ? {
                  lemma_id: startRun.lemma_id,
                  range_end_lemma_id:
                      endRun.range_end_lemma_id ?? endRun.lemma_id,
              }
            : unanchored;
    }

    if (target.kind === 'run') {
        const run = passage.runs[target.index];

        return run
            ? {
                  lemma_id: run.lemma_id,
                  range_end_lemma_id: run.range_end_lemma_id,
              }
            : unanchored;
    }

    return unanchored;
}

function saveNote(passage: WindowPassage) {
    if (!noteDraft.value.trim()) {
        return;
    }

    if (editingNoteId.value !== null) {
        router.patch(
            updateComment.url(editingNoteId.value),
            { note: noteDraft.value },
            { preserveScroll: true, onSuccess: () => cancelNote() },
        );

        return;
    }

    // Writing a note and recording a conjecture are alternatives, so saving
    // one closes the panel just as submitting the other does.
    const done = () => {
        cancelNote();
        closePopover();
    };

    router.post(
        storeComment.url(props.edition),
        {
            canonical_passage_id: passage.id,
            ...noteAnchor(passage),
            note: noteDraft.value,
        },
        { preserveScroll: true, onSuccess: done },
    );
}

function removeNote(comment: EditionComment) {
    if (!window.confirm('Delete this note?')) {
        return;
    }

    router.delete(destroyComment.url(comment.id), { preserveScroll: true });
}

/** The words a note is anchored to, for showing what it is about. */
function noteAnchorText(
    passage: WindowPassage,
    comment: EditionComment,
): string | null {
    if (comment.lemma_id === null) {
        return null;
    }

    const start = passage.runs.findIndex(
        (run) => run.lemma_id === comment.lemma_id,
    );

    if (start === -1) {
        return null;
    }

    const end =
        comment.range_end_lemma_id === null
            ? start
            : passage.runs.findIndex(
                  (run) => run.lemma_id === comment.range_end_lemma_id,
              );

    return passage.runs
        .slice(start, (end === -1 ? start : end) + 1)
        .map((run) => run.text)
        .filter((text) => text !== '')
        .join(' ');
}

/** Whether this passage's popover is open — its block box then ends the line. */
function popoverOpenOn(passageId: number): boolean {
    return openTarget.value?.passageId === passageId;
}

// The one way to dismiss whichever popover (Add Conjecture, Select Variant,
// or Insert Lacuna) is currently open, regardless of how it got opened —
// a click on its own trigger already toggles it closed, but a selection-
// triggered Add Conjecture has no such trigger to click again.
function closePopover() {
    openTarget.value = null;
    submitError.value = null;
    openConjectureId.value = null;
    closeProposalDraft();
}

// Insertion points between every pair of words sit in the DOM only while
// this is on — an always-present marker between every single word both
// clutters the text and gets in the way of dragging a clean text selection
// across it (see onDocumentMouseUp). Toggling it off again drops whatever
// insertion popover happened to be open, since its own trigger just left
// the DOM.
const lacunaMode = ref(false);

function toggleLacunaMode() {
    lacunaMode.value = !lacunaMode.value;

    if (openTarget.value?.kind === 'boundary') {
        closePopover();
    }
}

// ---- registering a transposition conjecture: cut & paste in the text ----
// "Register transposition conjecture" turns the edition text into a draft:
// select text — whole lines or part of a line — and press Ctrl+X to lift
// it out, put the caret somewhere and press Ctrl+V to set it down. The
// text is a sequence of PIECES: a piece is a whole passage, or part of one
// once a cut divided it, exactly as a witness's citation of a line can
// stand in two places; a piece pasted into a line divides that line. On
// Register, every difference between the stored order and the draft IS the
// conjecture — one Reordering over the smallest citation-contiguous stretch
// covering the change, its pieces with their words
// (conjecture-orderings.store). An arrangement that divides a line is
// reported like a witness's split citation; the edition prints whole
// lines, so only an arrangement of whole lines can also be adopted. Copy
// is refused: text moves, it never multiplies. (User decision, replacing
// the marker-based rearrange mode and the server's derived "what did this
// move mean".)
const registering = ref(false);
const draftPieces = ref<DraftPiece[]>([]);
const heldPieces = ref<DraftPiece[]>([]);
const registerDraft = reactive({
    proposed_by: '',
    note: '',
    references: [] as DraftReference[],
});
const registerError = ref<string | null>(null);

/** A run of one passage's words, by run index, as the draft moves it. */
type DraftPiece = { passageId: number; runStart: number; runEnd: number };

/** What the text renders: a passage, or one part of it, with its runs. */
type Piece = {
    passage: WindowPassage;
    runStart: number;
    runEnd: number;
    part: number;
    parts: number;
    runs: { run: Run; runIndex: number }[];
};

// A passage printed in pieces has one row per part; every row carries
// the passage's full runs, so the first row stands for the passage.
const passageById = computed(() => {
    const byId = new Map<number, WindowPassage>();

    for (const row of props.windowPassages) {
        if (!byId.has(row.id)) {
            byId.set(row.id, row);
        }
    }

    return byId;
});

/** The printed rows as draft pieces — a divided line starts divided. */
function printedPieces(): DraftPiece[] {
    return props.windowPassages.map((row) => ({
        passageId: row.id,
        runStart: row.run_start,
        runEnd: row.run_end,
    }));
}

/** Number a passage's pieces in the passage's own order, as a witness's parts are. */
function toPieces(drafts: DraftPiece[]): Piece[] {
    const counts = new Map<number, number>();
    const ranks = new Map<DraftPiece, number>();

    for (const draft of drafts) {
        counts.set(draft.passageId, (counts.get(draft.passageId) ?? 0) + 1);
    }

    for (const passageId of counts.keys()) {
        drafts
            .filter((draft) => draft.passageId === passageId)
            .sort((a, b) => a.runStart - b.runStart)
            .forEach((draft, index) => ranks.set(draft, index + 1));
    }

    return drafts.flatMap((draft) => {
        const passage = passageById.value.get(draft.passageId);

        if (!passage) {
            return [];
        }

        return [
            {
                passage,
                runStart: draft.runStart,
                runEnd: draft.runEnd,
                part: ranks.get(draft) ?? 1,
                parts: counts.get(draft.passageId) ?? 1,
                runs: passage.runs
                    .slice(draft.runStart, draft.runEnd + 1)
                    .map((run, index) => ({
                        run,
                        runIndex: draft.runStart + index,
                    })),
            },
        ];
    });
}

/** The window's text in the order it shows: whole passages, or the draft's pieces. */
const shownPieces = computed<Piece[]>(() =>
    registering.value
        ? toPieces(draftPieces.value)
        : props.windowPassages.map((row) => ({
              passage: row,
              runStart: row.run_start,
              runEnd: row.run_end,
              part: row.part,
              parts: row.parts,
              runs: row.runs
                  .slice(row.run_start, row.run_end + 1)
                  .map((run, index) => ({
                      run,
                      runIndex: row.run_start + index,
                  })),
          })),
);

function startRegistering() {
    registering.value = true;
    draftPieces.value = printedPieces();
    heldPieces.value = [];
    registerDraft.proposed_by = '';
    registerDraft.note = '';
    registerDraft.references = [];
    registerError.value = null;
    closePopover();
}

function stopRegistering() {
    registering.value = false;
    draftPieces.value = [];
    heldPieces.value = [];
    registerError.value = null;
}

function passageLabel(id: number): string {
    return passageById.value.get(id)?.label ?? '?';
}

/** "3" or "3–8", from the first and last of a run of passages. */
function rangeLabel(ids: number[]): string {
    const first = passageLabel(ids[0]);
    const last = passageLabel(ids[ids.length - 1]);

    return first === last ? first : `${first}–${last}`;
}

function pieceText(draft: DraftPiece): string {
    return (passageById.value.get(draft.passageId)?.runs ?? [])
        .slice(draft.runStart, draft.runEnd + 1)
        .map((run) => run.text)
        .join(' ');
}

/** "3", or "3 2/2" for a part of a divided passage — the apparatus's own citation. */
function pieceLabel(piece: Piece): string {
    return piece.parts > 1
        ? `${piece.passage.label} ${piece.part}/${piece.parts}`
        : piece.passage.label;
}

function isWholePiece(draft: DraftPiece): boolean {
    const passage = passageById.value.get(draft.passageId);

    return (
        draft.runStart === 0 && draft.runEnd === (passage?.runs.length ?? 0) - 1
    );
}

const heldLabel = computed(() => {
    const held = heldPieces.value;

    if (held.length === 0) {
        return null;
    }

    if (held.length === 1 && !isWholePiece(held[0])) {
        return `part of ${passageLabel(held[0].passageId)}: “${pieceText(held[0])}”`;
    }

    return rangeLabel(held.map((piece) => piece.passageId));
});

/** Adjacent pieces of one passage that abut become one piece again. */
function mergedPieces(drafts: DraftPiece[]): DraftPiece[] {
    const merged: DraftPiece[] = [];

    for (const draft of drafts) {
        const last = merged[merged.length - 1];

        if (
            last &&
            last.passageId === draft.passageId &&
            last.runEnd + 1 === draft.runStart
        ) {
            merged[merged.length - 1] = { ...last, runEnd: draft.runEnd };
        } else {
            merged.push({ ...draft });
        }
    }

    return merged;
}

/** The runs a selection touches, grouped by the piece they stand in. */
function selectedRunsByPiece(): Map<number, { min: number; max: number }> {
    const box = editionTextEl.value;
    const selection = window.getSelection();
    const touched = new Map<number, { min: number; max: number }>();

    if (
        !box ||
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed
    ) {
        return touched;
    }

    const range = selection.getRangeAt(0);

    for (const el of box.querySelectorAll<HTMLElement>('[data-run-index]')) {
        if (!range.intersectsNode(el)) {
            continue;
        }

        const pieceIndex = Number(el.dataset.pieceIndex);
        const runIndex = Number(el.dataset.runIndex);
        const current = touched.get(pieceIndex);

        touched.set(pieceIndex, {
            min: Math.min(current?.min ?? runIndex, runIndex),
            max: Math.max(current?.max ?? runIndex, runIndex),
        });
    }

    return touched;
}

function onTextCut(event: ClipboardEvent) {
    if (!canEdit.value || inEditableIsland(event.target as Node)) {
        return;
    }

    event.preventDefault();

    if (!registering.value || heldPieces.value.length > 0) {
        return;
    }

    const touched = selectedRunsByPiece();

    if (touched.size === 0) {
        return;
    }

    const drafts = draftPieces.value;

    // Words within one piece: the cut divides it, and the words go as a
    // part of their line. Anything wider lifts out whole pieces.
    if (touched.size === 1) {
        const [pieceIndex, { min, max }] = [...touched.entries()][0];
        const piece = drafts[pieceIndex];

        if (piece && (min > piece.runStart || max < piece.runEnd)) {
            const rest: DraftPiece[] = [];

            if (min > piece.runStart) {
                rest.push({ ...piece, runEnd: min - 1 });
            }

            if (max < piece.runEnd) {
                rest.push({ ...piece, runStart: max + 1 });
            }

            heldPieces.value = [{ ...piece, runStart: min, runEnd: max }];
            draftPieces.value = [
                ...drafts.slice(0, pieceIndex),
                ...rest,
                ...drafts.slice(pieceIndex + 1),
            ];
            window.getSelection()?.removeAllRanges();

            return;
        }
    }

    const first = Math.min(...touched.keys());
    const last = Math.max(...touched.keys());
    const slice = drafts.slice(first, last + 1);

    if (slice.length === 0 || slice.length === drafts.length) {
        return;
    }

    heldPieces.value = slice;
    draftPieces.value = [...drafts.slice(0, first), ...drafts.slice(last + 1)];
    window.getSelection()?.removeAllRanges();
}

function onTextPaste(event: ClipboardEvent) {
    if (!canEdit.value || inEditableIsland(event.target as Node)) {
        return;
    }

    event.preventDefault();

    if (!registering.value || heldPieces.value.length === 0) {
        return;
    }

    const caret = caretPosition();
    const piece = caret ? draftPieces.value[caret.passageIndex] : undefined;

    if (!caret || !piece) {
        return;
    }

    // At a word's start the held text goes before that word, anywhere
    // else after it — as a paste in an editor would. Landing inside a
    // piece divides it around the pasted text.
    const before = caret.offset === 0;
    const drafts = draftPieces.value;
    let replacement: DraftPiece[] = [piece];
    let insertAt = caret.passageIndex + 1;

    if (before && caret.runIndex === piece.runStart) {
        insertAt = caret.passageIndex;
    } else if (!(!before && caret.runIndex === piece.runEnd)) {
        const cut = before ? caret.runIndex : caret.runIndex + 1;
        replacement = [
            { ...piece, runEnd: cut - 1 },
            { ...piece, runStart: cut },
        ];
    }

    const next = [
        ...drafts.slice(0, caret.passageIndex),
        ...replacement,
        ...drafts.slice(caret.passageIndex + 1),
    ];
    const held = heldPieces.value;
    next.splice(insertAt, 0, ...held);

    draftPieces.value = mergedPieces(next);
    heldPieces.value = [];

    void nextTick(() =>
        placeCaret({
            passageId: held[0].passageId,
            runIndex: held[0].runStart,
            offset: 0,
        }),
    );
}

function onTextCopy(event: ClipboardEvent) {
    if (registering.value && !inEditableIsland(event.target as Node)) {
        event.preventDefault();
    }
}

/**
 * What the draft changes, widened to citation contiguity: the passages of
 * every piece between the first and last that stand somewhere new, plus
 * every window passage whose citation falls inside that stretch's span —
 * the smallest statement about a stretch of the work that the server
 * accepts, with every piece of each passage in it. Empty while nothing
 * moved or something is still held.
 */
const registerPieces = computed<Piece[]>(() => {
    const current = printedPieces();
    const draft = draftPieces.value;

    if (heldPieces.value.length > 0 || draft.length === 0) {
        return [];
    }

    const same = (a: DraftPiece, b: DraftPiece) =>
        a.passageId === b.passageId &&
        a.runStart === b.runStart &&
        a.runEnd === b.runEnd;

    let first = 0;

    while (
        first < current.length &&
        first < draft.length &&
        same(current[first], draft[first])
    ) {
        first++;
    }

    if (first === current.length && first === draft.length) {
        return [];
    }

    let endCurrent = current.length - 1;
    let endDraft = draft.length - 1;

    while (
        endCurrent >= first &&
        endDraft >= first &&
        same(current[endCurrent], draft[endDraft])
    ) {
        endCurrent--;
        endDraft--;
    }

    const involved = new Set(
        [
            ...current.slice(first, endCurrent + 1),
            ...draft.slice(first, endDraft + 1),
        ].map((piece) => piece.passageId),
    );
    const sortKey = new Map(props.workPassages.map((p) => [p.id, p.sort_key]));
    const keys = [...involved].map((id) => sortKey.get(id) ?? '');
    const min = keys.reduce((a, b) => (a < b ? a : b));
    const max = keys.reduce((a, b) => (a > b ? a : b));
    const members = new Set(
        props.windowPassages
            .filter((passage) => {
                const key = sortKey.get(passage.id) ?? '';

                return key >= min && key <= max;
            })
            .map((passage) => passage.id),
    );

    return toPieces(draft.filter((piece) => members.has(piece.passageId)));
});

/** Whether the arrangement divides a line — reportable, not printable. */
const registerDivides = computed(() =>
    registerPieces.value.some((piece) => piece.parts > 1),
);

const registerSummary = computed(() => {
    const pieces = registerPieces.value;

    if (pieces.length === 0) {
        return null;
    }

    const sortKey = new Map(props.workPassages.map((p) => [p.id, p.sort_key]));
    const byCitation = [
        ...new Set(pieces.map((piece) => piece.passage.id)),
    ].sort((a, b) =>
        (sortKey.get(a) ?? '') < (sortKey.get(b) ?? '') ? -1 : 1,
    );
    const reading = `${rangeLabel(byCitation)} will read ${pieces.map(pieceLabel).join(', ')}.`;

    return registerDivides.value
        ? `${reading} This divides a line; adopted, the edition prints it in pieces.`
        : reading;
});

function submitRegistration(adopt: boolean) {
    registerError.value = null;

    router.post(
        storeConjectureOrdering.url(props.edition),
        {
            pieces: registerPieces.value.map((piece) => ({
                canonical_passage_id: piece.passage.id,
                part: piece.part,
                text: pieceText({
                    passageId: piece.passage.id,
                    runStart: piece.runStart,
                    runEnd: piece.runEnd,
                }),
            })),
            proposed_by: registerDraft.proposed_by || null,
            note: registerDraft.note || null,
            references: draftReferencesPayload(registerDraft.references),
            follow: adopt,
        },
        {
            preserveScroll: true,
            onSuccess: () => stopRegistering(),
            onError: (errors) => {
                registerError.value =
                    Object.values(errors)[0] ??
                    'Could not register that arrangement.';
            },
        },
    );
}

// ---- lineation: the edition text behaves like an editor for line breaks ----
// The text box is a contenteditable host for editors, but every edit that
// would change the words is refused (beforeinput/paste/drop): only Enter,
// Backspace and Delete mean anything, and they act on the GAPS — the break
// before a collation column (EditionLineBreak) or before a passage (the
// EditionPassage flags). Enter breaks the line at the caret's word boundary
// (mid-word, after the word), Enter again opens a paragraph; Backspace at
// the start of a line and Delete at its end join lines, a paragraph first
// closing to a plain line break. All of it is this edition's own display
// data — no manuscript layout or collation is touched. Readers keep the
// plain text with focusable words.
const editionTextEl = ref<HTMLElement | null>(null);
const textFocused = ref(false);

type Caret = {
    /** Index into shownPieces — a passage, or one part of it while registering. */
    passageIndex: number;
    runIndex: number;
    offset: number;
    length: number;
};

/** A gap: before one run (colometry) or before a passage (`run` null). */
type Gap = { passage: WindowPassage; run: Run | null };

type CaretTarget = { passageId: number; runIndex: number; offset: number };

/** Chips, markers and open notices are islands: not text, not editable. */
function inEditableIsland(node: Node | null): boolean {
    const el = node instanceof Element ? node : node?.parentElement;

    return el?.closest('[contenteditable="false"]') !== null;
}

/**
 * Where the caret stands, in terms of runs: inside one (with its text
 * offset), or else "before the next run" — a caret in a chip's shadow, on a
 * blank paragraph line or at the very end lands on the nearest word the
 * way an editor would report it. A caret in the space after a word counts
 * as the end of that word, so Delete there joins the lines.
 */
function caretPosition(): Caret | null {
    const box = editionTextEl.value;
    const selection = window.getSelection();

    if (
        !box ||
        !selection ||
        selection.rangeCount === 0 ||
        !selection.isCollapsed
    ) {
        return null;
    }

    const caret = selection.getRangeAt(0);

    if (
        !box.contains(caret.startContainer) ||
        inEditableIsland(caret.startContainer)
    ) {
        return null;
    }

    const runs = [...box.querySelectorAll<HTMLElement>('[data-run-index]')];
    const describe = (runEl: HTMLElement, offset: number): Caret | null => {
        const passageIndex = Number(runEl.dataset.pieceIndex ?? -1);

        return passageIndex === -1
            ? null
            : {
                  passageIndex,
                  runIndex: Number(runEl.dataset.runIndex),
                  offset,
                  length: (runEl.textContent ?? '').length,
              };
    };

    const spacer = (
        caret.startContainer instanceof Element
            ? caret.startContainer
            : caret.startContainer.parentElement
    )?.closest<HTMLElement>('[data-spacer-run-index]');

    if (spacer && box.contains(spacer)) {
        const runEl = runs.find(
            (el) =>
                el.dataset.passageId === spacer.dataset.spacerPassageId &&
                el.dataset.runIndex === spacer.dataset.spacerRunIndex,
        );

        return runEl ? describe(runEl, (runEl.textContent ?? '').length) : null;
    }

    for (const runEl of runs) {
        const range = document.createRange();
        range.selectNodeContents(runEl);
        const side = range.comparePoint(
            caret.startContainer,
            caret.startOffset,
        );

        if (side < 0) {
            return describe(runEl, 0);
        }

        if (side === 0) {
            const before = document.createRange();
            before.setStart(runEl, 0);
            before.setEnd(caret.startContainer, caret.startOffset);

            return describe(runEl, before.toString().length);
        }
    }

    const last = runs.at(-1);

    return last ? describe(last, (last.textContent ?? '').length) : null;
}

function gapBeforeRun(passageIndex: number, runIndex: number): Gap | null {
    const piece = shownPieces.value[passageIndex];
    const passage = piece?.passage;

    if (!piece || !passage) {
        return null;
    }

    if (runIndex === piece.runStart) {
        // The very first passage of the edition has nothing before it.
        return passage.previous_edition_passage_id === null
            ? null
            : { passage, run: null };
    }

    const run = passage.runs[runIndex];

    // A break stands before a column; a run without one cannot carry it.
    return run && run.lemma_id !== null ? { passage, run } : null;
}

function gapAfterRun(passageIndex: number, runIndex: number): Gap | null {
    const passage = shownPieces.value[passageIndex]?.passage;

    if (!passage) {
        return null;
    }

    if (runIndex + 1 <= (shownPieces.value[passageIndex]?.runEnd ?? -1)) {
        return gapBeforeRun(passageIndex, runIndex + 1);
    }

    const next = shownPieces.value[passageIndex + 1]?.passage;

    return next ? { passage: next, run: null } : null;
}

/** 0 flows on, 1 a new line, 2 a new paragraph. */
function gapLevel(gap: Gap): 0 | 1 | 2 {
    if (gap.run === null) {
        return gap.passage.starts_new_paragraph
            ? 2
            : gap.passage.starts_new_line
              ? 1
              : 0;
    }

    return gap.run.break_before === 'paragraph'
        ? 2
        : gap.run.break_before === 'line'
          ? 1
          : 0;
}

/** The word that opens the line after this gap. */
function runAfterGap(gap: Gap): CaretTarget {
    return {
        passageId: gap.passage.id,
        runIndex: gap.run === null ? 0 : gap.passage.runs.indexOf(gap.run),
        offset: 0,
    };
}

function setGapLevel(gap: Gap, level: 0 | 1 | 2, caretAfter: CaretTarget) {
    const options = {
        preserveScroll: true,
        onSuccess: () => {
            void nextTick(() => placeCaret(caretAfter));
        },
    };

    if (gap.run === null) {
        router.patch(
            updatePassageLineation.url(gap.passage.edition_passage_id),
            { starts_new_line: level >= 1, starts_new_paragraph: level >= 2 },
            options,
        );

        return;
    }

    router.patch(
        updateLineBreak.url(props.edition.id),
        {
            lemma_id: gap.run.lemma_id,
            kind: level === 2 ? 'paragraph' : level === 1 ? 'line' : null,
        },
        options,
    );
}

/** Put the caret back where the edit leaves it once the text re-renders. */
function placeCaret(target: CaretTarget) {
    const box = editionTextEl.value;
    const runEl = box?.querySelector<HTMLElement>(
        `[data-passage-id="${target.passageId}"][data-run-index="${target.runIndex}"]`,
    );

    if (!box || !runEl) {
        return;
    }

    const walker = document.createTreeWalker(runEl, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    const range = document.createRange();

    if (textNode) {
        range.setStart(
            textNode,
            Math.min(target.offset, textNode.textContent?.length ?? 0),
        );
    } else {
        range.setStart(runEl, 0);
    }

    range.collapse(true);
    box.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function onTextKeydown(event: KeyboardEvent) {
    if (!canEdit.value || inEditableIsland(event.target as Node)) {
        return;
    }

    if (!['Enter', 'Backspace', 'Delete'].includes(event.key)) {
        return;
    }

    // Never let the browser touch the DOM, whatever the key combination.
    event.preventDefault();

    // While a transposition is being registered the text is a draft of the
    // order, and line breaks wait until it is settled.
    if (registering.value || event.ctrlKey || event.metaKey || event.altKey) {
        return;
    }

    const caret = caretPosition();

    if (!caret) {
        return;
    }

    const atStart = caret.offset === 0;
    const atEnd = caret.offset >= caret.length;

    if (event.key === 'Enter') {
        const gap = atStart
            ? gapBeforeRun(caret.passageIndex, caret.runIndex)
            : gapAfterRun(caret.passageIndex, caret.runIndex);
        const level = gap ? gapLevel(gap) : 2;

        if (gap && level < 2) {
            setGapLevel(gap, (level + 1) as 1 | 2, runAfterGap(gap));
        }

        return;
    }

    const gap =
        event.key === 'Backspace'
            ? atStart
                ? gapBeforeRun(caret.passageIndex, caret.runIndex)
                : null
            : atEnd
              ? gapAfterRun(caret.passageIndex, caret.runIndex)
              : null;
    const level = gap ? gapLevel(gap) : 0;

    if (gap && level > 0) {
        const passage = shownPieces.value[caret.passageIndex].passage;
        setGapLevel(gap, (level - 1) as 0 | 1, {
            passageId: passage.id,
            runIndex: caret.runIndex,
            offset: event.key === 'Backspace' ? 0 : caret.length,
        });
    }
}

/** Typing, pasting, dropping, formatting: none of it may change the words. */
function blockTextEdit(event: Event) {
    if (canEdit.value && !inEditableIsland(event.target as Node)) {
        event.preventDefault();
    }
}

function onTextFocus(event: FocusEvent, focused: boolean) {
    if (!inEditableIsland(event.target as Node)) {
        textFocused.value = focused;
    }
}

/** Readers open a word's notice from the keyboard; editors' Enter is a line break. */
function onRunKey(passageId: number, runIndex: number, event: KeyboardEvent) {
    if (canEdit.value) {
        return;
    }

    event.preventDefault();
    toggleRun(passageId, runIndex);
}

// The page is always two panes: the edition on the left, the witnesses on
// the right — where a manuscript is read and its segments are picked for
// the edition (user decision, merging the former add pane and pane choice).
// With the witness's photograph open, the word under the pointer lights
// up its box on the image, and the box under the pointer its words —
// exactly as in the transcript editor (user decision). The correspondence
// goes through the collation column: a run's base offsets and each
// candidate's own witness offsets say where every witness has this word.
const hoveredEditionPassageId = ref<number | null>(null);
const hoveredRun = ref<{ passageId: number; runIndex: number } | null>(null);
const imageLitRunKeys = ref<Set<string>>(new Set());

type WitnessSpan = { layerId: number; start: number; end: number };

/** Every witness's stretch of text at a run's column. */
function witnessSpansOf(passage: WindowPassage, run: Run): WitnessSpan[] {
    const spans: WitnessSpan[] = [];

    if (
        passage.base !== null &&
        run.base_start !== null &&
        run.base_end !== null
    ) {
        spans.push({
            layerId: passage.base.transcription_layer_id,
            start: run.base_start,
            end: run.base_end,
        });
    }

    for (const candidate of run.candidates) {
        if (
            candidate.transcription_layer_id !== null &&
            candidate.start_offset !== null &&
            candidate.end_offset !== null
        ) {
            spans.push({
                layerId: candidate.transcription_layer_id,
                start: candidate.start_offset,
                end: candidate.end_offset,
            });
        }
    }

    return spans;
}

const hoveredSpans = computed<WitnessSpan[]>(() => {
    const target = hoveredRun.value;
    const passage = target
        ? passageById.value.get(target.passageId)
        : undefined;
    const run = passage?.runs[target?.runIndex ?? -1];

    return passage && run ? witnessSpansOf(passage, run) : [];
});

/** Light the words the image box under the pointer is aligned to. */
function onImageRegionHover(target: {
    spans: WitnessSpan[];
    passageIds: number[];
}) {
    const keys = new Set<string>();

    for (const passage of props.windowPassages) {
        passage.runs.forEach((run, runIndex) => {
            const lit =
                target.passageIds.includes(passage.id) ||
                witnessSpansOf(passage, run).some((mine) =>
                    target.spans.some(
                        (span) =>
                            span.layerId === mine.layerId &&
                            span.start < mine.end &&
                            span.end > mine.start,
                    ),
                );

            if (lit) {
                keys.add(`${passage.id}:${runIndex}`);
            }
        });
    }

    imageLitRunKeys.value = keys;
}

// ---- the order panel: everything about one block of the order report ----

/** Conjectures this edition has already recorded itself as following. */
const adoptedConjectureIds = computed(
    () => new Set(props.transpositions.map((t) => t.conjecture_id)),
);

// The number chip carries the derived reports: violet for a split
// citation, the order palette for a moved line, sky for a note. One colour
// at a time — a split is rarer and more specific than an order block, so it
// wins.
function passageChipClasses(passage: WindowPassage): string[] {
    if (passage.discontinuous_witnesses.length > 0) {
        return [
            'cursor-pointer bg-violet-200 text-violet-800 hover:bg-violet-300 dark:bg-violet-950 dark:text-violet-300 dark:hover:bg-violet-900',
        ];
    }

    if (passage.order_range && isOrderMoved(passage)) {
        return ['cursor-pointer', ...orderRangeClasses(passage.order_range)];
    }

    if (passage.comments.length > 0 || passage.references.length > 0) {
        return [
            'cursor-pointer bg-sky-300 text-sky-950 hover:bg-sky-400 dark:bg-sky-800/60 dark:text-sky-100 dark:hover:bg-sky-800',
        ];
    }

    return [
        'cursor-pointer bg-stone-200 text-stone-600 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700',
    ];
}

function passageChipTitle(passage: WindowPassage): string | undefined {
    if (passage.discontinuous_witnesses.length > 0) {
        return discontinuityTitle(passage.discontinuous_witnesses);
    }

    if (passage.order_range && isOrderMoved(passage)) {
        return orderStatements(passage.order_range, passage).join('; ');
    }

    if (passage.comments.length > 0 || passage.references.length > 0) {
        return [
            ...passage.comments.map((comment) => comment.note),
            ...passage.references.map((reference) => reference.citation),
        ].join('; ');
    }

    return 'What this line rests on';
}

function onChipClick(passage: WindowPassage) {
    // Every number opens the line's notice, for readers and editors
    // alike: what the line rests on, then its variants, references and
    // notes (user decision).
    toggleLine(passage.id);
}

// ---- what a line rests on: the top of its notice ----

/** Sigla of every visible normalized transcript citing this passage. */
function witnessesCiting(passage: WindowPassage): string[] {
    return [
        ...new Set(
            props.transcriptions
                .filter((transcription) =>
                    transcription.segments.some(
                        (segment) =>
                            segment.canonical_passage_id === passage.id,
                    ),
                )
                .map((transcription) => transcription.witness.siglum),
        ),
    ].sort();
}

function conjectureById(id: number | null): WorkConjecture | null {
    return id === null
        ? null
        : (props.workConjectures.find((conjecture) => conjecture.id === id) ??
              null);
}

function proposerOf(conjecture: WorkConjecture): string {
    return conjecture.proposed_by ?? conjecture.entered_by;
}

type ProvenanceLine = { text: string; conjectureId: number | null };

/**
 * "Based on R. Also present in R2." — or, for a line no witness has,
 * "Proposed by Bergk" naming the conjecture it prints; then where the
 * line's PLACE comes from, when that is not the text itself: "Ordering by
 * R2." or "Ordering by Bergk (conjecture)." — whichever source's arrangement
 * the edition prints, whole lines or divided ones alike — else "Ordering
 * by this edition." (user decision: the source is named at the top, and
 * only the sources that differ are listed as variants).
 */
function provenanceLines(passage: WindowPassage): ProvenanceLine[] {
    const lines: ProvenanceLine[] = [];
    const witnesses = witnessesCiting(passage);

    if (passage.base !== null) {
        const others = witnesses.filter(
            (siglum) => siglum !== passage.base?.witness_siglum,
        );

        lines.push({
            text:
                `Based on ${passage.base.witness_siglum}.` +
                (others.length > 0
                    ? ` Also present in ${others.join(', ')}.`
                    : ''),
            conjectureId: null,
        });
    } else {
        const selected = passage.runs
            .flatMap((run) => run.candidates)
            .find(
                (candidate) =>
                    candidate.selected && candidate.conjecture_id !== null,
            );
        const conjecture = conjectureById(selected?.conjecture_id ?? null);

        lines.push(
            conjecture !== null
                ? {
                      text: `Proposed by ${proposerOf(conjecture)}`,
                      conjectureId: conjecture.id,
                  }
                : { text: 'In no witness.', conjectureId: null },
        );
    }

    const ordering = orderingSource(passage);

    if (ordering !== null) {
        lines.push(ordering);
    }

    return lines;
}

/**
 * The source the printed order of this line's block follows, when it is
 * not the base text's own order. Null where the text's own order stands,
 * or where no source disagrees at all.
 */
function orderingSource(passage: WindowPassage): ProvenanceLine | null {
    const range = passage.order_range;
    const matching = range?.candidates.find(
        (candidate) =>
            candidate.matches_current && candidate.source !== 'citation',
    );

    if (matching?.source === 'transcription') {
        return matching.witness_siglum === passage.base?.witness_siglum
            ? null
            : {
                  text: `Ordering by ${matching.witness_siglum}.`,
                  conjectureId: null,
              };
    }

    if (matching) {
        const conjecture = conjectureById(matching.conjecture_id);

        return {
            text: `Ordering by ${conjecture !== null ? proposerOf(conjecture) : (matching.proposed_by ?? 'an anonymous')} (conjecture).`,
            conjectureId: matching.conjecture_id,
        };
    }

    // A divided line: the split-citation report knows which source's
    // arrangement the edition prints — an adopted conjecture first.
    const followed = [...passage.discontinuous_witnesses]
        .filter((source) => source.matches_current)
        .sort((a, b) => {
            const adoptedA =
                a.conjecture_id !== null &&
                adoptedConjectureIds.value.has(a.conjecture_id);
            const adoptedB =
                b.conjecture_id !== null &&
                adoptedConjectureIds.value.has(b.conjecture_id);

            return Number(adoptedB) - Number(adoptedA);
        })[0];

    if (followed) {
        return {
            text: `Ordering by ${followed.siglum}.`,
            conjectureId: followed.conjecture_id,
        };
    }

    return range || passage.discontinuous_witnesses.length > 0
        ? { text: 'Ordering by this edition.', conjectureId: null }
        : null;
}

/** The split citations that differ from what the edition prints. */
function splitVariants(passage: WindowPassage): DiscontinuousWitness[] {
    return passage.discontinuous_witnesses.filter(
        (source) => !source.matches_current,
    );
}

// ---- a conjecture, opened from its name: the edit form for editors, its
// bibliography for readers (user decision — citations are not printed in
// the notice itself). ----
const openConjectureId = ref<number | null>(null);

function toggleConjecture(id: number | null) {
    openConjectureId.value = openConjectureId.value === id ? null : id;
}

const lacunasForForm = computed(() =>
    props.workConjectures
        .filter((conjecture) => conjecture.type === 'lacuna')
        .map((conjecture) => ({
            id: conjecture.id,
            canonical_passage_id: conjecture.canonical_passage_id,
            label: `${conjecture.passage_label} — ${proposerOf(conjecture)}${conjecture.extent ? ` (${conjecture.extent})` : ''}`,
        })),
);

/** A conjecture's literature, each citation with its full reference where the page has it. */
function conjectureBibliography(conjecture: WorkConjecture) {
    return conjecture.references.map((reference) => ({
        id: reference.id,
        citation: reference.citation,
        reference:
            props.bibliography.find((entry) => entry.id === reference.item_id)
                ?.reference ?? null,
    }));
}

function candidateName(candidate: OrderCandidate): string {
    return candidate.source === 'citation'
        ? 'Citation order'
        : (candidate.witness_siglum ?? candidate.proposed_by ?? 'Anonymous');
}

// The label of the line printed immediately before the block's first
// member — the neighbour a head-of-block move anchors on. Null when the
// block opens the edition.
function labelBeforeRange(range: OrderRange): string | null {
    const index = props.passages.findIndex((item) =>
        range.member_canonical_passage_ids.includes(item.id),
    );

    return index > 0 ? props.passages[index - 1].label : null;
}

// Whether a disagreeing candidate's statement is about THIS line — the
// line is among the ones the candidate moves. A block's notice belongs to
// the line pressed: pressing 3 should say "R2: 3 comes after 8" and not
// also "R: 8 comes after 7", which is line 8's story (user decision).
function candidateMoves(
    range: OrderRange,
    candidate: OrderCandidate,
    passage: WindowPassage,
): boolean {
    return analyzeSequence(
        range.current_sequence,
        candidate.sequence,
    ).movedLabels.has(passage.label);
}

// "R2: 3 comes after 8" — one statement per source that disagrees with the
// printed order by moving THIS line; the number chip's hover title and, one
// per line, the click panel. Citation order is a candidate, never a
// source, so it never speaks here.
function orderStatements(range: OrderRange, passage: WindowPassage): string[] {
    return range.candidates
        .filter(
            (candidate) =>
                !candidate.matches_current &&
                candidate.source !== 'citation' &&
                candidateMoves(range, candidate, passage),
        )
        .map(
            (candidate) =>
                `${candidateName(candidate)}: ${analyzeSequence(range.current_sequence, candidate.sequence, labelBeforeRange(range)).text}`,
        );
}

// The panel lists only what DISAGREES with the printed order ABOUT THIS
// LINE: that a source agrees is no news (a later feature will show which
// manuscripts accord with the printed text), citation order least of all —
// the labels on the lines already say it — and a source moving some other
// line of the block speaks on that line's notice. The one exception is a
// matching, not-yet-followed conjecture, kept for editors so "Record as
// followed" has somewhere to live.
function panelCandidates(
    range: OrderRange,
    passage: WindowPassage,
): OrderCandidate[] {
    return range.candidates.filter((candidate) =>
        candidate.source === 'citation'
            ? false
            : candidate.matches_current
              ? canEdit.value &&
                candidate.conjecture_id !== null &&
                !adoptedConjectureIds.value.has(candidate.conjecture_id)
              : candidateMoves(range, candidate, passage),
    );
}

// The line number itself is the order marker: it takes the block colour
// exactly on the lines some source MOVES — the lines that merely slide to
// make room stay plain, matching the statements above.
function isOrderMoved(passage: WindowPassage): boolean {
    const range = passage.order_range;

    if (!range) {
        return false;
    }

    return range.candidates.some(
        (candidate) =>
            !candidate.matches_current &&
            candidate.source !== 'citation' &&
            analyzeSequence(
                range.current_sequence,
                candidate.sequence,
            ).movedLabels.has(passage.label),
    );
}

// ---- recording another proposed order for an open block ----
// Replaces the old standalone reordering panel and its from/to dropdowns:
// a proposal only means anything about a block's stretch, so it is
// authored where the block's other candidates already sit, members
// preloaded. Submitting may apply it too (conjecture-orderings.store with
// `follow`) — propose-and-follow in one step, attribution included — or
// only record it, so a catalogued proposal the editor does NOT adopt still
// enters the apparatus as a candidate (user decision).
const proposalDraft = reactive({
    open: false,
    order: [] as { id: number; label: string }[],
    proposed_by: '',
    references: [] as DraftReference[],
});

function openProposalDraft(range: OrderRange) {
    proposalDraft.open = true;
    proposalDraft.order = range.member_canonical_passage_ids.map(
        (id, index) => ({ id, label: range.current_sequence[index] }),
    );
    proposalDraft.proposed_by = '';
    proposalDraft.references = [];
}

function closeProposalDraft() {
    proposalDraft.open = false;
    proposalDraft.order = [];
}

function moveProposalEntry(index: number, delta: -1 | 1) {
    const target = index + delta;

    if (target < 0 || target >= proposalDraft.order.length) {
        return;
    }

    const entries = proposalDraft.order;
    [entries[index], entries[target]] = [entries[target], entries[index]];
}

function submitOrderProposal(follow: boolean) {
    submitError.value = null;

    router.post(
        storeConjectureOrdering.url(props.edition),
        {
            canonical_passage_ids: proposalDraft.order.map((entry) => entry.id),
            proposed_by: proposalDraft.proposed_by || null,
            references: draftReferencesPayload(proposalDraft.references),
            follow,
        },
        {
            preserveScroll: true,
            onSuccess: () => {
                closeProposalDraft();
                closePopover();
            },
            onError: (errors) => {
                submitError.value =
                    Object.values(errors)[0] ?? 'Could not record that order.';
            },
        },
    );
}

function isRunOpen(passageId: number, runIndex: number): boolean {
    return (
        openTarget.value?.passageId === passageId &&
        openTarget.value?.kind === 'run' &&
        openTarget.value.index === runIndex
    );
}

function isBoundaryOpen(passageId: number, boundaryIndex: number): boolean {
    return (
        openTarget.value?.passageId === passageId &&
        openTarget.value?.kind === 'boundary' &&
        openTarget.value.index === boundaryIndex
    );
}

function isLineOpen(passageId: number): boolean {
    return (
        openTarget.value?.passageId === passageId &&
        openTarget.value?.kind === 'line'
    );
}

function isRunInPendingRange(passageId: number, runIndex: number): boolean {
    return (
        openTarget.value?.passageId === passageId &&
        openTarget.value?.kind === 'range' &&
        runIndex >= openTarget.value.startIndex &&
        runIndex <= openTarget.value.endIndex
    );
}

const conjectureDraft = reactive({
    text: '',
    // The conjecture is that these words should not be read at all — a
    // deletion, which carries no text (see ConjectureType::Deletion).
    deletion: false,
    proposed_by: '',
    references: [] as DraftReference[],
    note: '',
});

const lacunaDraft = reactive({
    label: '',
    extent: '',
    extent_characters: '' as number | '',
    proposed_by: '',
    references: [] as DraftReference[],
    note: '',
});

function resetLacunaDraft() {
    lacunaDraft.label = '';
    lacunaDraft.extent = '';
    lacunaDraft.extent_characters = '';
    lacunaDraft.proposed_by = '';
    lacunaDraft.references = [];
    lacunaDraft.note = '';
}

function resetConjectureDraft() {
    conjectureDraft.text = '';
    conjectureDraft.deletion = false;
    conjectureDraft.proposed_by = '';
    conjectureDraft.references = [];
    conjectureDraft.note = '';
}

// The anchor whose own pending (unselected) candidate reaches at least this
// far, if any — the interior runs a not-yet-adopted range candidate would
// swallow (still independently rendered, since nothing's decided) carry no
// candidate of their own that says so. Used to flag the whole disputed span
// as "needs a decision" (see runClasses) and to hover the site as one.
function coveringAnchorIndex(
    passage: WindowPassage,
    runIndex: number,
): number | null {
    for (let i = runIndex - 1; i >= 0; i--) {
        const reachesHere = passage.runs[i].candidates.some((candidate) => {
            if (candidate.range_end_lemma_id === null || candidate.selected) {
                return false;
            }

            const endIndex = passage.runs.findIndex(
                (run) => run.lemma_id === candidate.range_end_lemma_id,
            );

            return endIndex >= runIndex;
        });

        if (reachesHere) {
            return i;
        }
    }

    return null;
}

// A candidate as the popover offers it, with the run it is actually
// picked at: a word's own candidates sit on its own run; a wider reading
// reaching over it from an earlier column (a witness's omission of several
// words, an unadopted range conjecture, a witness's phrase against several
// columns) is picked at that column, and is listed here so that the editor
// sees every reading bearing on the word she clicked — and can still reach
// the word's own, such as a deletion registered on it alone.
type OfferedCandidate = Candidate & { anchorRun: Run };

function popoverCandidates(
    passage: WindowPassage,
    runIndex: number,
): OfferedCandidate[] {
    const run = passage.runs[runIndex];
    const own = run.candidates.map((candidate) => ({
        ...candidate,
        anchorRun: run,
    }));
    const covering: OfferedCandidate[] = [];

    for (let i = runIndex - 1; i >= 0; i--) {
        const anchor = passage.runs[i];

        for (const candidate of anchor.candidates) {
            if (candidate.range_end_lemma_id === null || candidate.selected) {
                continue;
            }

            const endIndex = passage.runs.findIndex(
                (r) => r.lemma_id === candidate.range_end_lemma_id,
            );

            if (endIndex >= runIndex) {
                covering.push({ ...candidate, anchorRun: anchor });
            }
        }
    }

    return [
        ...groupWitnesses(own, passage),
        ...groupWitnesses(covering, passage),
    ];
}

// Witnesses that read the same are one row — "R, R2: ἥδʼ ἐξέρχεται." — the
// way the apparatus names a reading once and then its sigla (user
// decision). The row stands for one reading, picked when adopted: the one
// already selected, else the base's, else the first; the others say the
// same words at the same span, so which is chosen changes nothing printed.
// Conjectures are never grouped. The popover shows the normalized wording
// only — what the manuscripts write is the hover apparatus's "as written"
// (user decision): listed beside a grouped row it would suggest the group
// was formed on spelling, which it is not.
function groupWitnesses(
    candidates: OfferedCandidate[],
    passage: WindowPassage,
): OfferedCandidate[] {
    const groups = new Map<string, OfferedCandidate[]>();

    for (const candidate of candidates) {
        const key =
            candidate.conjecture_id !== null
                ? candidate.key
                : [
                      candidate.anchorRun.lemma_id,
                      candidate.range_end_lemma_id,
                      candidate.omitted
                          ? 'omitted'
                          : sameReading(candidate.text),
                  ].join('|');

        groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }

    return [...groups.values()].map((members) => {
        if (members.length === 1) {
            return members[0];
        }

        const representative =
            members.find((member) => member.selected) ??
            members.find(
                (member) =>
                    member.transcription_layer_id ===
                    passage.base?.transcription_layer_id,
            ) ??
            members[0];

        return {
            ...representative,
            label: members.map((member) => member.label).join(', '),
            selected: members.some((member) => member.selected),
            needs_review: members.some((member) => member.needs_review),
        };
    });
}

// Open to readers too: the candidate list is the apparatus, and a
// conjecture's name there is how a reader reaches its literature (the
// picks, the supplement form and Revert stay behind canEdit).
function toggleRun(passageId: number, runIndex: number) {
    // A drag just landed here — the mouseup handler below already opened
    // (or will open) the Add Conjecture popover for the selection; a plain
    // click shouldn't also open Select Variant on top of it.
    if (window.getSelection()?.isCollapsed === false) {
        return;
    }

    const passage = props.windowPassages.find((p) => p.id === passageId);

    if (!passage) {
        return;
    }

    // Every word can be opened, not only the disputed ones: an editor may
    // want to say something about a word all the witnesses agree on, and a
    // note is written from this panel. The clicked word itself opens, never
    // a redirect to an earlier anchor: its own candidates (a deletion
    // registered on it, say) would be unreachable from there. The wider
    // readings covering it from an earlier column are listed alongside —
    // see popoverCandidates.
    if (isRunOpen(passageId, runIndex)) {
        openTarget.value = null;

        return;
    }

    openTarget.value = { passageId, kind: 'run', index: runIndex };
    resetConjectureDraft();
    submitError.value = null;
}

function toggleBoundary(passageId: number, boundaryIndex: number) {
    if (!canEdit.value) {
        return;
    }

    if (isBoundaryOpen(passageId, boundaryIndex)) {
        openTarget.value = null;

        return;
    }

    openTarget.value = { passageId, kind: 'boundary', index: boundaryIndex };
    resetLacunaDraft();
    submitError.value = null;
}

function toggleLine(passageId: number) {
    closeProposalDraft();
    openConjectureId.value = null;

    if (isLineOpen(passageId)) {
        openTarget.value = null;

        return;
    }

    openTarget.value = { passageId, kind: 'line' };
    submitError.value = null;
}

// Distinguishes the "before" and "after" markers around the same passage —
// each carries its own anchor (the preceding EditionPassage.id, or null for
// the very start of the edition), so clicking the other marker while one is
// open switches the anchor instead of just closing the popover.
function isNewPassageOpenAt(
    passageId: number,
    afterEditionPassageId: number | null,
): boolean {
    return (
        openTarget.value?.passageId === passageId &&
        openTarget.value?.kind === 'new_passage' &&
        openTarget.value.afterEditionPassageId === afterEditionPassageId
    );
}

// The whole-line-lacuna entry point — unlike a point lacuna (placement=
// insert into an already-numbered passage), this creates a brand new
// passage the editor names directly (e.g. "80A"). Available near any
// passage while lacuna mode is active, regardless of whether that passage
// itself has a base/runs yet — the marker is just a convenient click point
// near the relevant text; `afterEditionPassageId` is what actually anchors
// where the new passage lands in this edition's own order.
function toggleNewPassage(
    passageId: number,
    afterEditionPassageId: number | null,
) {
    if (!canEdit.value) {
        return;
    }

    if (isNewPassageOpenAt(passageId, afterEditionPassageId)) {
        openTarget.value = null;

        return;
    }

    openTarget.value = {
        passageId,
        kind: 'new_passage',
        afterEditionPassageId,
    };
    resetLacunaDraft();
    submitError.value = null;
}

// The preceding passage's own EditionPassage id, as the server derived it
// from the whole printed order — null only at the very start of the
// edition. (Read off the page's neighbour, the first passage of page 2+
// anchored a whole-line lacuna at the edition's start instead of before
// itself.)
function previousEditionPassageId(passageIndex: number): number | null {
    return shownPieces.value[passageIndex].passage.previous_edition_passage_id;
}

// Selecting a span of the continuous text is the one way to author a brand
// new conjecture — a plain click that never turns into a drag leaves the
// selection collapsed and is ignored here (toggleRun's own @click handles
// that instead). Every run touched by the selection is found via
// Range.intersectsNode rather than resolving the selection's own anchor/
// focus nodes — a drag almost never ends exactly on a run's own text (the
// mouse releases in the whitespace between two words far more often than
// not), and anchor/focus resolution silently misses the whole selection
// whenever that happens. Intersection doesn't care where the range's own
// endpoints happen to sit, only which runs it overlaps at all.
function onDocumentMouseUp() {
    // A selection while registering is a cut in the making, not a conjecture.
    if (!canEdit.value || registering.value) {
        return;
    }

    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
    }

    const range = selection.getRangeAt(0);
    const touched: { passageId: number; runIndex: number }[] = [];

    for (const el of document.querySelectorAll<HTMLElement>(
        '[data-run-index]',
    )) {
        if (range.intersectsNode(el)) {
            touched.push({
                passageId: Number(el.dataset.passageId),
                runIndex: Number(el.dataset.runIndex),
            });
        }
    }

    if (touched.length === 0) {
        return;
    }

    const passageId = touched[0].passageId;
    const passageIds = [...new Set(touched.map((t) => t.passageId))];

    const passage = props.windowPassages.find((p) => p.id === passageId);

    if (!passage) {
        return;
    }

    // The app's own sky highlight (see runClasses/isRunInPendingRange) takes
    // over from here — the native selection has done its job.
    selection.removeAllRanges();

    // A selection reaching into several segments can only mean removing
    // them, whole (user decision); within one segment it opens the
    // conjecture box, which offers removal too.
    if (passageIds.length > 1) {
        openTarget.value = { passageId, kind: 'remove', passageIds };
        submitError.value = null;

        return;
    }

    const indices = touched.map((t) => t.runIndex);
    const startIndex = Math.min(...indices);
    const endIndex = Math.max(...indices);

    if (passage.runs[startIndex].gap || passage.runs[endIndex].gap) {
        return;
    }

    openTarget.value = { passageId, kind: 'range', startIndex, endIndex };
    resetConjectureDraft();
    submitError.value = null;
}

onMounted(() => document.addEventListener('mouseup', onDocumentMouseUp));
onUnmounted(() => document.removeEventListener('mouseup', onDocumentMouseUp));

function submitCommon(passage: WindowPassage, fields: Record<string, unknown>) {
    submitError.value = null;

    router.post(
        storeVariant.url(props.edition),
        { canonical_passage_id: passage.id, ...fields },
        {
            preserveScroll: true,
            onSuccess: () => {
                openTarget.value = null;
            },
            onError: (errors) => {
                submitError.value =
                    Object.values(errors)[0] ?? 'Could not apply that choice.';
            },
        },
    );
}

function submitAtRun(
    passage: WindowPassage,
    run: Run,
    fields: Record<string, unknown>,
) {
    submitCommon(passage, {
        lemma_id: run.lemma_id,
        base_start_offset: run.base_start ?? 0,
        base_end_offset: run.base_end ?? 0,
        ...fields,
    });
}

type Boundary = { afterLemmaId: number | null; afterBaseOffset: number | null };

function boundaryBefore(runs: Run[], index: number): Boundary {
    const previous = index > 0 ? runs[index - 1] : null;

    return {
        afterLemmaId: previous?.lemma_id ?? null,
        afterBaseOffset: previous?.base_end ?? null,
    };
}

function submitAtBoundary(
    passage: WindowPassage,
    boundary: Boundary,
    fields: Record<string, unknown>,
) {
    submitCommon(passage, {
        placement: 'insert',
        insert_after_lemma_id: boundary.afterLemmaId,
        insert_after_base_offset: boundary.afterBaseOffset,
        ...fields,
    });
}

// A witness candidate carrying range_end_lemma_id needs placement=range,
// not the ordinary single-column placement=existing — whether that range
// is a reading PassageAligner already persisted, or one this candidate's
// own text was only just extended to cover for comparison (see the backend's
// EditionController::witnessExtension — picking it creates the matching
// reading on the spot, same as if PassageAligner had merged it automatically).
function pickWitness(passage: WindowPassage, run: Run, candidate: Candidate) {
    if (candidate.range_end_lemma_id !== null) {
        submitCommon(passage, {
            placement: 'range',
            range_start_lemma_id: run.lemma_id,
            range_end_lemma_id: candidate.range_end_lemma_id,
            source: 'transcription',
            transcription_layer_id: candidate.transcription_layer_id,
            start_offset: candidate.start_offset,
            end_offset: candidate.end_offset,
        });

        return;
    }

    submitAtRun(passage, run, {
        source: 'transcription',
        transcription_layer_id: candidate.transcription_layer_id,
        start_offset: candidate.start_offset,
        end_offset: candidate.end_offset,
    });
}

function pickConjecture(
    passage: WindowPassage,
    run: Run,
    conjectureId: number,
) {
    submitAtRun(passage, run, {
        source: 'existing_conjecture',
        conjecture_id: conjectureId,
    });
}

// The plain text a pending range selection would replace — several
// already-rendered runs joined back together for display only.
function rangeSelectionText(
    passage: WindowPassage,
    target: OpenTarget,
): string {
    if (target.kind !== 'range') {
        return '';
    }

    return passage.runs
        .slice(target.startIndex, target.endIndex + 1)
        .map((run) => run.text)
        .join(' ');
}

// The one way to author a brand new substitution (or deletion) conjecture —
// a selection touching only one run is just a range of one. "Register" only catalogues
// it as a candidate (see EditionVariantController::isNewSubstitution);
// "Register and adopt" selects it for this edition in the same step. A
// transposition of words is never typed here: it is cut and pasted in the
// text itself under "Register transposition conjecture".
function submitConjecture(
    passage: WindowPassage,
    startIndex: number,
    endIndex: number,
    adopt: boolean,
) {
    const startRun = passage.runs[startIndex];
    const endRun = passage.runs[endIndex];

    submitCommon(passage, {
        placement: 'range',
        range_start_lemma_id: startRun.lemma_id,
        range_start_base_offset: startRun.base_start ?? 0,
        range_end_lemma_id: endRun.range_end_lemma_id ?? endRun.lemma_id,
        range_end_base_offset: endRun.base_end ?? 0,
        source: 'new_conjecture',
        conjecture_type: conjectureDraft.deletion ? 'deletion' : 'substitution',
        conjecture_text: conjectureDraft.deletion ? null : conjectureDraft.text,
        conjecture_proposed_by: conjectureDraft.proposed_by || null,
        conjecture_references: draftReferencesPayload(
            conjectureDraft.references,
        ),
        conjecture_note: conjectureDraft.note || null,
        adopt,
    });
}

// A range's one EditionLemma row is keyed by its start lemma like any other
// decision, so reverting it needs no dedicated backend route.
function revertRange(run: Run) {
    if (run.lemma_id === null) {
        return;
    }

    router.delete(destroyEditionLemma.url([props.edition, run.lemma_id]), {
        preserveScroll: true,
        onSuccess: () => {
            openTarget.value = null;
        },
    });
}

// A run whose candidates include a lacuna is itself a lacuna column — the
// only thing that can be proposed there is a supplement, never a plain
// substitution (a lacuna is a pure insertion, so nothing else competes at
// that column).
function lacunaCandidateOf(run: Run): Candidate | undefined {
    return run.candidates.find(
        (candidate) => candidate.conjecture_type === 'lacuna',
    );
}

function unplacedForRun(
    passage: WindowPassage,
    run: Run,
): UnplacedConjecture[] {
    const lacuna = lacunaCandidateOf(run);

    if (lacuna) {
        return passage.unplacedConjectures.filter(
            (c) =>
                c.type === 'supplement' &&
                c.supplements_conjecture_id === lacuna.conjecture_id,
        );
    }

    return passage.unplacedConjectures.filter(
        (c) => c.type === 'substitution' || c.type === 'deletion',
    );
}

// A supplement still goes through the ordinary placement=existing path,
// since it targets its lacuna's own single column — never a range, so it
// stays out of the selection-driven Add Conjecture flow entirely (see
// submitConjecture, reached only via onDocumentMouseUp/toggleRun).
function submitSupplementForRun(passage: WindowPassage, run: Run) {
    const lacuna = lacunaCandidateOf(run);

    if (!lacuna) {
        return;
    }

    submitAtRun(passage, run, {
        source: 'new_conjecture',
        conjecture_type: 'supplement',
        conjecture_text: conjectureDraft.text,
        conjecture_supplements_conjecture_id: lacuna.conjecture_id,
        conjecture_proposed_by: conjectureDraft.proposed_by || null,
        conjecture_references: draftReferencesPayload(
            conjectureDraft.references,
        ),
        conjecture_note: conjectureDraft.note || null,
    });
}

function unplacedLacunasFor(passage: WindowPassage): UnplacedConjecture[] {
    return passage.unplacedConjectures.filter((c) => c.type === 'lacuna');
}

function pickUnplacedLacuna(
    passage: WindowPassage,
    boundary: Boundary,
    conjectureId: number,
) {
    submitAtBoundary(passage, boundary, {
        source: 'existing_conjecture',
        conjecture_id: conjectureId,
    });
}

function submitNewLacuna(passage: WindowPassage, boundary: Boundary) {
    submitAtBoundary(passage, boundary, {
        source: 'new_conjecture',
        conjecture_type: 'lacuna',
        conjecture_extent: lacunaDraft.extent || null,
        conjecture_extent_characters: lacunaDraft.extent_characters || null,
        conjecture_proposed_by: lacunaDraft.proposed_by || null,
        conjecture_references: draftReferencesPayload(lacunaDraft.references),
        conjecture_note: lacunaDraft.note || null,
    });
}

// A whole-line lacuna never targets an existing canonical_passage_id — the
// backend resolves (or creates, on first mention) the passage from `label`
// alone, via the work's own ReferenceScheme (see CanonicalPassageResolver).
// `insert_after_edition_passage_id` anchors where it lands in this
// edition's own order — only meaningful the first time this label is
// added; a repeat submission finds the same passage and leaves it in place.
function submitWholeLineLacuna() {
    if (openTarget.value?.kind !== 'new_passage') {
        return;
    }

    submitError.value = null;

    router.post(
        storeVariant.url(props.edition),
        {
            placement: 'new_passage',
            label: lacunaDraft.label,
            insert_after_edition_passage_id:
                openTarget.value.afterEditionPassageId,
            source: 'new_conjecture',
            conjecture_type: 'lacuna',
            conjecture_extent: lacunaDraft.extent || null,
            conjecture_extent_characters: lacunaDraft.extent_characters || null,
            conjecture_proposed_by: lacunaDraft.proposed_by || null,
            conjecture_references: draftReferencesPayload(
                lacunaDraft.references,
            ),
            conjecture_note: lacunaDraft.note || null,
        },
        {
            preserveScroll: true,
            onSuccess: () => {
                openTarget.value = null;
            },
            onError: (errors) => {
                submitError.value =
                    Object.values(errors)[0] ?? 'Could not apply that choice.';
            },
        },
    );
}

// Frees the passage back up in every transcription citing it, for free —
// see EditionPassageController::destroy.
/** Remove whole segments from the edition — one, or every one a selection touched. */
function removeEditionPassages(passageIds: number[]) {
    router.delete(destroyEditionPassage.url(props.edition), {
        data: { canonical_passage_ids: passageIds },
        preserveScroll: true,
        onSuccess: () => {
            openTarget.value = null;
        },
    });
}

/** "3", "3 and 4", "3, 4 and 7". */
function passageListLabel(ids: number[]): string {
    const labels = ids.map(passageLabel);

    return labels.length <= 1
        ? (labels[0] ?? '')
        : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// Apply one of the report's candidate orders to its range: the stored
// positions are rewritten to the source's own sequence. Applying a
// catalogued conjecture also records the application as attribution; a
// witness's or citation order needs none — "matches witness B" is
// derivable and shown by the report itself. Never an authoring step (see
// ReorderingAuthorPanel for that).
/** Adopt a registered proposal reported on a line it divides. */
function adoptArrangement(conjectureId: number) {
    submitError.value = null;

    router.post(
        storeEditionAdoption.url(props.edition),
        { conjecture_id: conjectureId },
        {
            preserveScroll: true,
            onError: (errors) => {
                submitError.value =
                    Object.values(errors)[0] ??
                    'Could not adopt that proposal.';
            },
        },
    );
}

function chooseOrder(range: OrderRange, candidate: OrderCandidate) {
    submitError.value = null;

    router.post(
        applyEditionOrder.url(props.edition),
        {
            range_start_canonical_passage_id:
                range.range_start_canonical_passage_id,
            range_end_canonical_passage_id:
                range.range_end_canonical_passage_id,
            transcription_layer_id: candidate.transcription_layer_id,
            conjecture_id: candidate.conjecture_id,
        },
        {
            preserveScroll: true,
            onSuccess: () => {
                openTarget.value = null;
            },
            onError: (errors) => {
                submitError.value =
                    Object.values(errors)[0] ?? 'Could not apply that order.';
            },
        },
    );
}

// Insertion points render between every pair of adjacent runs (and at
// either end) so a lacuna can be dropped in anywhere — but only once the
// passage actually has word-level structure to sit between; a whole-passage
// gap placeholder has none.
function showsBoundaries(passage: WindowPassage): boolean {
    return (
        canEdit.value &&
        lacunaMode.value &&
        !registering.value &&
        passage.runs.length > 0 &&
        !passage.runs.some((run) => run.gap)
    );
}

// Highlighting reflects actual textual disagreement, not just candidate
// count — several witnesses can independently attest the very same reading
// at a column (or a work can have more than one transcription of the same
// witness), and that shouldn't read as "needs a decision."
function hasVariation(run: Run): boolean {
    // An empty text is never a reading: a witness omitting a word simply
    // has no candidate on the column, so an empty one is a flagged remnant
    // of edited-away transcription text (offsets past the end read as "").
    // It still appears in the popover with its needs-review badge for the
    // editor to resolve — it just doesn't claim the manuscripts disagree
    // (real bug: a stale remnant painted τέκνον as a variant site).
    //
    // A witness's omission (or a deletion conjecture) is the opposite: an
    // empty text that IS a reading — "B has no word here" disagrees with
    // every witness that has one.
    return (
        new Set(
            run.candidates
                .filter(
                    (candidate) => candidate.omitted || candidate.text !== '',
                )
                .map((candidate) =>
                    candidate.omitted ? '\u0000omitted' : candidate.text,
                ),
        ).size > 1
    );
}

/**
 * The editor's notes bearing on one word: those anchored to the site it
 * belongs to, and those about the line as a whole, which bear on every word
 * of it.
 *
 * Read from the tooltip rather than under the line, which is where they
 * belong while editing but clutters the text when reading it.
 */
/** The runs an anchored note is pinned to, as [start, end], or null. */
function noteSpan(
    passage: WindowPassage,
    comment: EditionComment,
): [number, number] | null {
    if (comment.lemma_id === null) {
        return null;
    }

    const start = passage.runs.findIndex(
        (run) => run.lemma_id === comment.lemma_id,
    );

    if (start === -1) {
        return null;
    }

    const end =
        comment.range_end_lemma_id === null
            ? start
            : passage.runs.findIndex(
                  (run) => run.lemma_id === comment.range_end_lemma_id,
              );

    return [start, end === -1 ? start : end];
}

/** Where the anchored note covering this run begins, if one does. */
function noteSpanStart(
    passage: WindowPassage,
    runIndex: number,
): number | null {
    for (const comment of passage.comments) {
        const span = noteSpan(passage, comment);

        if (span !== null && runIndex >= span[0] && runIndex <= span[1]) {
            return span[0];
        }
    }

    return null;
}

/** Whether the editor has written about this word in particular. */
function hasAnchoredNote(passage: WindowPassage, runIndex: number): boolean {
    return noteSpanStart(passage, runIndex) !== null;
}

function notesFor(passage: WindowPassage, run: Run): EditionComment[] {
    const runIndex = passage.runs.indexOf(run);

    return passage.comments.filter((comment) => {
        const span = noteSpan(passage, comment);

        // A note about the line bears on every word of it.
        return span === null
            ? comment.lemma_id === null
            : runIndex >= span[0] && runIndex <= span[1];
    });
}

// One floating panel, positioned on hover (or keyboard focus), rather than
// a hidden one beside every word — a full page of text is several hundred
// words. Kept inside the viewport: clamped on the right, and flipped above
// the word near the bottom, where it used to run off screen.
const TOOLTIP_WIDTH = 448; // max-w-md
const TOOLTIP_FLIP_MARGIN = 240;

const hovered = ref<{
    passage: WindowPassage;
    run: Run;
    left: number;
    top: number | null;
    bottom: number | null;
} | null>(null);

function showReadings(event: Event, passage: WindowPassage, runIndex: number) {
    hoveredRun.value = { passageId: passage.id, runIndex };
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // The site's own run, so hovering any word of a transposition reports the
    // whole competing phrase rather than the one word under the cursor.
    const run = passage.runs[siteAnchorIndex(passage, runIndex)];
    const flipAbove = rect.bottom + TOOLTIP_FLIP_MARGIN > window.innerHeight;

    hovered.value = {
        passage,
        run,
        left: Math.max(
            8,
            Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - 8),
        ),
        top: flipAbove ? null : rect.bottom + 4,
        bottom: flipAbove ? window.innerHeight - rect.top + 4 : null,
    };
}

function hideReadings() {
    hovered.value = null;
    hoveredRun.value = null;
}

/**
 * The run that speaks for a variant site: itself, or the earlier run whose
 * wider reading covers it.
 *
 * A transposition or any many-to-one variant reaches the reader as several
 * adjacent columns answering to one reading elsewhere — B's "Διὸς καὶ Λητοῦς"
 * against three columns of the base. They are one place in the text where the
 * tradition differs, and should read as one.
 */
function siteAnchorIndex(passage: WindowPassage, runIndex: number): number {
    return coveringAnchorIndex(passage, runIndex) ?? runIndex;
}

function sameSite(passage: WindowPassage, a: number, b: number): boolean {
    if (a < 0 || b >= passage.runs.length) {
        return false;
    }

    if (siteAnchorIndex(passage, a) === siteAnchorIndex(passage, b)) {
        return true;
    }

    // A note pinned across several words holds them together too.
    const start = noteSpanStart(passage, a);

    return start !== null && start === noteSpanStart(passage, b);
}

/**
 * The space between two words, highlighted when both belong to the same
 * variant site — otherwise a site spanning three words reads as three
 * separate marks with gaps between them.
 */
function spacerClasses(passage: WindowPassage, runIndex: number): string[] {
    const next = runIndex + 1;
    const fill = siteFill(passage, passage.runs[runIndex], runIndex);

    return next < passage.runs.length &&
        sameSite(passage, runIndex, next) &&
        fill !== null
        ? [fill]
        : [];
}

/**
 * A word is marked where the witnesses disagree, and for no other reason.
 *
 * Not whether the editor has "decided" it: the base transcription is itself a
 * decision, standing until another reading is chosen, so every word of the
 * text is already decided and there is no reviewed/unreviewed state to show.
 * What a reader wants at a glance is where the tradition differs; what an
 * editor wants is the same thing.
 */
/** Whether this edition prints a conjecture here rather than any witness. */
function printsConjecture(run: Run): boolean {
    const selected = run.candidates.find((candidate) => candidate.selected);

    return selected !== undefined && selected.conjecture_id !== null;
}

/**
 * The mark a word carries, or null for none. Three things are worth seeing at
 * a glance, and they are told apart by colour:
 *
 * - the manuscripts differ here — the ordinary variant site;
 * - the printed reading is nobody's manuscript but a conjecture, which is a
 *   stronger claim about the text and so a stronger mark;
 * - the editor has written about the word though the witnesses agree.
 *
 * Ordered by what most needs saying: a conjecture over a disputed word is
 * still a conjecture, and a note beside a real variant is the lesser fact.
 *
 * The steps are chosen by chroma, not by matching step numbers across hues —
 * Tailwind's palette is not perceptually uniform, and `sky-100` carries less
 * than half the saturation of `amber-100`, faint enough on an uncalibrated
 * monitor to read as no highlight at all. Variant and note are deliberately
 * level (amber-200 at 0.120, sky-300 at 0.111) so neither outshouts the other,
 * and the conjecture sits clearly above both (amber-400 at 0.189). Move one of
 * these and you must move the rest, or the ordering above stops holding.
 */
function siteFill(
    passage: WindowPassage,
    run: Run,
    runIndex: number,
): string | null {
    if (printsConjecture(run)) {
        return 'bg-amber-400 dark:bg-amber-700/60';
    }

    if (hasVariation(run) || coveringAnchorIndex(passage, runIndex) !== null) {
        return 'bg-amber-200 dark:bg-amber-900/50';
    }

    return hasAnchoredNote(passage, runIndex)
        ? 'bg-sky-300 dark:bg-sky-800/60'
        : null;
}

function runClasses(
    passage: WindowPassage,
    run: Run,
    runIndex: number,
): string[] {
    // Neutral, not blue: this marks what the editor is currently selecting,
    // which is UI state rather than a fact about the text, and a blue fill
    // here would read as a note that has already been saved.
    if (isRunInPendingRange(passage.id, runIndex)) {
        return ['rounded-sm bg-stone-300 dark:bg-stone-600'];
    }

    // The words the image box under the pointer is aligned to — the
    // transcript editor's amber.
    if (imageLitRunKeys.value.has(`${passage.id}:${runIndex}`)) {
        return ['rounded-sm bg-amber-300/60 dark:bg-amber-800/60'];
    }

    const fill = siteFill(passage, run, runIndex);

    if (fill === null) {
        return [];
    }

    // Rounded only where the site begins and ends, so the words between run
    // together into one mark.
    const opensSite = !sameSite(passage, runIndex - 1, runIndex);
    const closesSite = !sameSite(passage, runIndex, runIndex + 1);

    return [
        fill,
        opensSite ? 'rounded-l-sm' : '',
        closesSite ? 'rounded-r-sm' : '',
    ];
}

// The moved line's number is a calm derived report, like the violet
// split-citation number: there is no "unsettled" state to escalate, because
// the stored order IS the decision. Color says only what kind of source the
// current order happens to match: emerald when a manuscript's own order
// matches, sky when only a conjecture does, stone when the current order
// matches no listed source — the editor's own arrangement, a legitimate
// state, not a warning (it was amber once, and amber on every rearranged
// line read as eight alarms about one decision).
function orderRangeClasses(range: OrderRange): string[] {
    const matching = range.candidates.find((c) => c.matches_current);

    if (matching === undefined) {
        return [
            'bg-stone-200 text-stone-600 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700',
        ];
    }

    if (matching.source === 'conjecture') {
        return [
            'bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-400 dark:hover:bg-sky-900',
        ];
    }

    return [
        'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:hover:bg-emerald-900',
    ];
}
</script>

<template>
    <Head :title="`${props.edition.title} — ${props.work.title}`" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-8 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-6xl">
            <AppHeader />

            <!-- Everything that pertains to the EDITION lives in this one
                 box, the same device as the witness page's Witness box, so
                 the user always knows which editor she is in. -->
            <fieldset
                class="mt-2 mb-6 inline-block min-w-80 rounded-lg border border-stone-300 px-4 pb-3 text-sm dark:border-stone-700"
            >
                <legend
                    class="px-2 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
                >
                    Edition
                </legend>

                <div
                    class="flex flex-wrap items-baseline justify-between gap-4"
                >
                    <h1 class="font-serif text-2xl font-medium">
                        {{ props.edition.title }}
                    </h1>
                    <div class="flex items-center gap-2 text-xs">
                        <select
                            v-if="canEdit && props.can.publish"
                            :value="props.edition.visibility"
                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            @change="
                                saveVisibility(
                                    ($event.target as HTMLSelectElement)
                                        .value as Visibility,
                                )
                            "
                        >
                            <option value="published">Published</option>
                            <option value="draft">Draft</option>
                        </select>
                        <span v-else class="text-stone-500 dark:text-stone-400">
                            {{ props.edition.visibility }}
                        </span>
                    </div>
                </div>
                <p
                    v-if="props.edition.description"
                    class="text-stone-600 dark:text-stone-400"
                >
                    {{ props.edition.description }}
                </p>

                <!-- The witnesses that cite the work at all — not only those
                     this edition draws on so far — so an editor sees what
                     is available and a reader what was left aside. -->
                <div
                    class="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-0.5"
                >
                    <span class="text-xs text-stone-500 dark:text-stone-400"
                        >Witnesses</span
                    >
                    <span class="flex flex-wrap gap-x-3 gap-y-0.5">
                        <template v-if="props.witnesses.length === 0">
                            <span class="text-stone-500 dark:text-stone-400"
                                >none cite this work yet</span
                            >
                        </template>
                        <Link
                            v-for="witness in props.witnesses"
                            :key="witness.id"
                            :href="showWitness.url(witness.id)"
                            class="hover:underline"
                            :class="
                                witness.in_edition
                                    ? ''
                                    : 'text-stone-500 dark:text-stone-400'
                            "
                            :title="
                                witness.in_edition
                                    ? 'Text of this edition is based on it'
                                    : 'Cites the work; not used in this edition yet'
                            "
                        >
                            <span class="font-serif">{{ witness.siglum }}</span
                            ><template v-if="witness.label">
                                &mdash; {{ witness.label }}</template
                            >
                        </Link>
                    </span>
                </div>

                <div
                    class="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400"
                >
                    <template v-if="canEdit">
                        <button
                            type="button"
                            class="underline"
                            @click="editingHeader = !editingHeader"
                        >
                            {{
                                editingHeader
                                    ? 'Cancel'
                                    : 'Edit title/description'
                            }}
                        </button>
                        <button
                            v-if="props.can.delete"
                            type="button"
                            class="text-red-600 underline dark:text-red-400"
                            @click="removeEdition"
                        >
                            Delete edition
                        </button>
                    </template>
                    <button
                        v-if="props.can.copy"
                        type="button"
                        class="underline"
                        title="Your own copy — of the edition, and of the work, witnesses and conjectures it stands on"
                        @click="copyEdition"
                    >
                        Copy this edition
                    </button>
                    <button
                        v-if="mayEdit"
                        type="button"
                        class="rounded border px-2 py-1"
                        :class="
                            readerView
                                ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                : 'border-stone-300 dark:border-stone-700'
                        "
                        @click="readerView = !readerView"
                    >
                        {{
                            readerView ? 'Back to editing' : 'Read as a reader'
                        }}
                    </button>
                </div>

                <!-- Who holds the edition. The owner alone publishes,
                     deletes, invites editors and hands it on; a reader
                     sees only the name. -->
                <div
                    class="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-0.5 text-xs"
                >
                    <span class="text-stone-500 dark:text-stone-400"
                        >Owner</span
                    >
                    <span>{{ props.access.owner?.name ?? '—' }}</span>
                    <template v-if="props.can.manage || props.can.transfer">
                        <span class="text-stone-500 dark:text-stone-400"
                            >Editors</span
                        >
                        <span
                            class="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                        >
                            <span
                                v-if="props.access.editors.length === 0"
                                class="text-stone-500 dark:text-stone-400"
                                >nobody else yet</span
                            >
                            <span
                                v-for="editor in props.access.editors"
                                :key="editor.id"
                                :title="editor.email"
                            >
                                {{ editor.name }}
                                <button
                                    v-if="props.can.manage"
                                    type="button"
                                    class="ml-1 text-red-600 underline dark:text-red-400"
                                    @click="revokeEditor(editor.id)"
                                >
                                    remove
                                </button>
                            </span>
                            <form
                                v-if="props.can.manage"
                                class="flex items-baseline gap-1"
                                @submit.prevent="grantEditor"
                            >
                                <input
                                    v-model="editorForm.email"
                                    type="email"
                                    placeholder="member's email"
                                    class="w-48 rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                                />
                                <button
                                    type="submit"
                                    class="underline"
                                    :disabled="editorForm.processing"
                                >
                                    Invite to edit
                                </button>
                                <span
                                    v-if="editorForm.errors.email"
                                    class="text-red-600 dark:text-red-400"
                                    >{{ editorForm.errors.email }}</span
                                >
                            </form>
                        </span>
                        <span class="text-stone-500 dark:text-stone-400"
                            >Hand on</span
                        >
                        <span
                            class="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                        >
                            <template v-if="props.access.offer">
                                <span :title="props.access.offer.to.email"
                                    >offered to
                                    {{ props.access.offer.to.name }}, awaiting
                                    an answer</span
                                >
                                <button
                                    v-if="props.can.transfer"
                                    type="button"
                                    class="text-red-600 underline dark:text-red-400"
                                    @click="
                                        withdrawOffer(props.access.offer.id)
                                    "
                                >
                                    withdraw
                                </button>
                            </template>
                            <form
                                v-else-if="props.can.transfer"
                                class="flex items-baseline gap-1"
                                @submit.prevent="offerOwnership"
                            >
                                <input
                                    v-model="transferForm.email"
                                    type="email"
                                    placeholder="member's email"
                                    class="w-48 rounded border border-stone-300 bg-transparent px-1 py-0.5 dark:border-stone-700"
                                />
                                <button
                                    type="submit"
                                    class="underline"
                                    :disabled="transferForm.processing"
                                >
                                    Offer ownership
                                </button>
                                <span
                                    v-if="transferForm.errors.email"
                                    class="text-red-600 dark:text-red-400"
                                    >{{ transferForm.errors.email }}</span
                                >
                            </form>
                        </span>
                    </template>
                </div>

                <form
                    v-if="editingHeader"
                    class="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-stone-300 p-3 text-sm dark:border-stone-700"
                    @submit.prevent="saveHeader"
                >
                    <input
                        v-model="headerForm.title"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <span
                        v-if="headerForm.errors.title"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ headerForm.errors.title }}</span
                    >
                    <textarea
                        v-model="headerForm.description"
                        rows="2"
                        class="rounded border border-stone-300 bg-transparent p-2 dark:border-stone-700"
                    />
                    <button
                        type="submit"
                        class="self-start rounded bg-stone-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        :disabled="headerForm.processing"
                    >
                        Save
                    </button>
                </form>
            </fieldset>

            <!-- Always two panes: the edition on the left, and on the right
                 whichever view the reader or editor picked. The manuscripts
                 used to be shown interlinearly, printed under each word of
                 the edition, which read as clutter in the middle of the text
                 rather than as a manuscript. They get their own pane now. -->
            <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <div>
                    <fieldset
                        class="rounded-lg border border-stone-200 px-3 pb-3 text-xs dark:border-stone-800"
                    >
                        <legend
                            class="px-2 text-xs font-medium tracking-widest text-stone-500 uppercase dark:text-stone-400"
                        >
                            Edition text
                        </legend>

                        <!-- One control row, level with the witnesses pane's:
                             the editing tools, then the jump form. -->
                        <div
                            class="mb-2 flex min-h-9 flex-wrap items-center gap-2 border-b border-stone-200 pb-2 dark:border-stone-800"
                        >
                            <template v-if="canEdit">
                                <button
                                    type="button"
                                    class="rounded border px-2 py-1"
                                    :class="
                                        lacunaMode
                                            ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400'
                                            : 'border-stone-300 dark:border-stone-700'
                                    "
                                    @click="toggleLacunaMode"
                                >
                                    {{
                                        lacunaMode
                                            ? 'Done inserting lacunas'
                                            : '+ Insert lacuna'
                                    }}
                                </button>
                                <button
                                    type="button"
                                    class="rounded border px-2 py-1"
                                    :class="
                                        registering
                                            ? 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                                            : 'border-stone-300 dark:border-stone-700'
                                    "
                                    @click="
                                        registering
                                            ? stopRegistering()
                                            : startRegistering()
                                    "
                                >
                                    {{
                                        registering
                                            ? 'Cancel registering'
                                            : 'Register transposition conjecture'
                                    }}
                                </button>
                            </template>
                            <form
                                v-if="props.passages.length > 0"
                                class="ml-auto flex flex-wrap items-center gap-2"
                                @submit.prevent="jumpToPassage"
                            >
                                <label
                                    for="jump-to-line"
                                    class="text-stone-500 dark:text-stone-400"
                                    >Go to line</label
                                >
                                <input
                                    id="jump-to-line"
                                    v-model="jumpLabel"
                                    list="edition-passage-labels"
                                    type="text"
                                    class="w-24 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                />
                                <datalist id="edition-passage-labels">
                                    <option
                                        v-for="passage in props.passages"
                                        :key="passage.id"
                                        :value="passage.label"
                                    />
                                </datalist>
                                <button
                                    type="submit"
                                    class="rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                                >
                                    Go
                                </button>
                                <span
                                    v-if="jumpError"
                                    class="text-red-600 dark:text-red-400"
                                    >{{ jumpError }}</span
                                >
                            </form>
                        </div>

                        <div
                            v-if="props.totalPages > 1"
                            class="mb-2 flex items-center justify-between border-b border-stone-200 pb-2 text-stone-500 dark:border-stone-800 dark:text-stone-400"
                        >
                            <button
                                type="button"
                                class="underline disabled:opacity-30"
                                :disabled="props.page <= 1"
                                @click="goToPage(props.page - 1)"
                            >
                                &larr; Previous
                            </button>
                            <span
                                >Page {{ props.page }} of
                                {{ props.totalPages }}</span
                            >
                            <button
                                type="button"
                                class="underline disabled:opacity-30"
                                :disabled="props.page >= props.totalPages"
                                @click="goToPage(props.page + 1)"
                            >
                                Next &rarr;
                            </button>
                        </div>

                        <!-- The conjecture box for a transposition: above the
                             text it is drafted in, and it stays until the
                             editor registers or gives up. -->
                        <div
                            v-if="registering"
                            class="mb-2 flex flex-col gap-2 rounded border border-emerald-200 bg-emerald-50 p-2 font-sans dark:border-emerald-900 dark:bg-emerald-950"
                        >
                            <p class="text-stone-600 dark:text-stone-300">
                                Move the text below until it stands as the
                                proposal reads it: select whole lines or part of
                                a line and press Ctrl+X to lift it out, put the
                                caret where it belongs and press Ctrl+V. Text
                                moves, and nothing is copied. Every difference
                                from the current order becomes the conjecture; a
                                part pasted into a line divides that line, as a
                                witness's citation can.
                            </p>
                            <p class="text-emerald-800 dark:text-emerald-300">
                                <template v-if="heldLabel">
                                    Holding {{ heldLabel }} — put the caret
                                    where it belongs and press Ctrl+V.
                                </template>
                                <template v-else-if="registerSummary">
                                    {{ registerSummary }}
                                </template>
                                <template v-else>Nothing moved yet.</template>
                            </p>
                            <input
                                v-model="registerDraft.proposed_by"
                                type="text"
                                placeholder="First proposed by"
                                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            />
                            <textarea
                                v-model="registerDraft.note"
                                rows="2"
                                placeholder="Note"
                                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            ></textarea>
                            <ReferencePicker
                                v-model="registerDraft.references"
                                class="w-full"
                                :registry="props.bibliographyForm.registry"
                                :suggestions="
                                    props.bibliographyForm.suggestions
                                "
                            />
                            <span class="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    class="rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                    :disabled="registerPieces.length === 0"
                                    title="Catalogue the proposal as a candidate; the edition keeps its current order"
                                    @click="submitRegistration(false)"
                                >
                                    Register
                                </button>
                                <button
                                    type="button"
                                    class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50 dark:border-stone-700"
                                    :disabled="registerPieces.length === 0"
                                    title="Catalogue the proposal and print the text as drafted below"
                                    @click="submitRegistration(true)"
                                >
                                    Register and adopt
                                </button>
                                <button
                                    type="button"
                                    class="text-stone-500 underline"
                                    @click="stopRegistering"
                                >
                                    Cancel
                                </button>
                                <span
                                    v-if="registerError"
                                    class="text-red-600 dark:text-red-400"
                                    >{{ registerError }}</span
                                >
                            </span>
                        </div>

                        <div
                            ref="editionTextEl"
                            class="rounded border border-stone-200 p-2 font-serif text-lg leading-loose dark:border-stone-800"
                            :class="
                                canEdit &&
                                'focus:ring-1 focus:ring-sky-300 focus:outline-none dark:focus:ring-sky-800'
                            "
                            :contenteditable="canEdit ? 'true' : undefined"
                            spellcheck="false"
                            @keydown="onTextKeydown"
                            @beforeinput="blockTextEdit"
                            @paste="onTextPaste"
                            @cut="onTextCut"
                            @copy="onTextCopy"
                            @drop="blockTextEdit"
                            @dragstart="blockTextEdit"
                            @focusin="onTextFocus($event, true)"
                            @focusout="onTextFocus($event, false)"
                        >
                            <!-- An empty edition and a work nothing cites are
                             different situations, and only the second is a
                             dead end. Saying "this work has no canonical
                             passages" for both told an editor with a perfectly
                             good transcription that there was nothing to do,
                             when the text was one click away in the panel. -->
                            <p
                                v-if="!props.windowPassages.length"
                                class="font-sans text-sm text-stone-500 dark:text-stone-400"
                            >
                                <template v-if="!props.transcriptions.length">
                                    No transcription cites this work yet. An
                                    edition takes its text from cited
                                    transcriptions, so there is nothing to add
                                    until one exists.
                                </template>
                                <template v-else-if="canEdit">
                                    This edition has no text yet. Select text in
                                    a witness on the right and press “Add
                                    selection”.
                                </template>
                                <template v-else>
                                    This edition has no text yet.
                                </template>
                            </p>

                            <!-- Passages render INLINE and every printed break is
                             an explicit element, so verse, flowing prose and
                             mixtures all come from the same mechanism: the
                             edition's own lineation flags — never from any
                             manuscript's line breaks. -->
                            <template
                                v-for="(
                                    { passage, part, parts, runs }, passageIndex
                                ) in shownPieces"
                                :key="`${passage.id}-${part}`"
                            >
                                <div
                                    v-if="
                                        (!registering || part === 1) &&
                                        passage.starts_new_paragraph &&
                                        passageIndex > 0
                                    "
                                    class="h-4"
                                    aria-hidden="true"
                                ></div>
                                <!-- An open popover is a block box that already
                                 ends the line; a <br> after it would print
                                 an empty line (real gap under every open
                                 notice). -->
                                <br
                                    v-else-if="
                                        (!registering || part === 1) &&
                                        passage.starts_new_line &&
                                        passageIndex > 0 &&
                                        !popoverOpenOn(
                                            shownPieces[passageIndex - 1]
                                                .passage.id,
                                        )
                                    "
                                />
                                <article
                                    :id="
                                        part === 1
                                            ? `passage-${passage.id}`
                                            : undefined
                                    "
                                    :data-piece-index="passageIndex"
                                    class="inline"
                                    @mouseenter="
                                        hoveredEditionPassageId = passage.id
                                    "
                                    @mouseleave="hoveredEditionPassageId = null"
                                >
                                    <!-- The number chip is where the derived
                                     reports live: violet when a witness cites
                                     this line in more than one place, the
                                     order palette when a source moves this
                                     line — clicking opens the statement. -->
                                    <!-- A real button, so the report a number
                                     opens is reachable from the keyboard. -->
                                    <button
                                        type="button"
                                        contenteditable="false"
                                        class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide select-none"
                                        :class="[passageChipClasses(passage)]"
                                        :title="passageChipTitle(passage)"
                                        @click="onChipClick(passage)"
                                    >
                                        {{
                                            parts > 1
                                                ? `${passage.label} ${part}/${parts}`
                                                : passage.label
                                        }}
                                    </button>

                                    <button
                                        v-if="
                                            canEdit &&
                                            lacunaMode &&
                                            !registering
                                        "
                                        type="button"
                                        contenteditable="false"
                                        class="mr-1 rounded bg-amber-100 px-1 align-middle font-sans text-xs leading-normal text-amber-700 select-none hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                                        title="Insert a whole-line lacuna before this passage"
                                        @click="
                                            toggleNewPassage(
                                                passage.id,
                                                previousEditionPassageId(
                                                    passageIndex,
                                                ),
                                            )
                                        "
                                    >
                                        + line
                                    </button>

                                    <template v-if="passage.base === null">
                                        <span
                                            class="font-sans text-sm text-stone-400 italic dark:text-stone-600"
                                            >No base transcription assigned to
                                            this passage yet.</span
                                        >
                                    </template>
                                    <template v-else-if="!passage.runs.length">
                                        <span
                                            class="font-sans text-sm text-stone-400 italic dark:text-stone-600"
                                            >Nothing transcribed for this
                                            passage yet.</span
                                        >
                                    </template>
                                    <template
                                        v-else-if="
                                            passage.division_stale && part > 1
                                        "
                                    >
                                        <span
                                            class="font-sans text-sm text-stone-400 italic dark:text-stone-600"
                                            >this part of {{ passage.label }} no
                                            longer matches the printed words;
                                            the whole line prints at its first
                                            part</span
                                        >
                                    </template>
                                    <template v-else>
                                        <template
                                            v-for="{ run, runIndex } in runs"
                                            :key="runIndex"
                                        >
                                            <div
                                                v-if="
                                                    run.break_before ===
                                                    'paragraph'
                                                "
                                                class="h-4"
                                                aria-hidden="true"
                                            ></div>
                                            <br
                                                v-else-if="
                                                    run.break_before === 'line'
                                                "
                                            />
                                            <span
                                                v-if="showsBoundaries(passage)"
                                                contenteditable="false"
                                                class="mx-0.5 cursor-pointer rounded bg-amber-100 px-1 align-middle font-sans text-xs leading-normal text-amber-700 select-none hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                                                title="Insert a lacuna here"
                                                @click="
                                                    toggleBoundary(
                                                        passage.id,
                                                        runIndex,
                                                    )
                                                "
                                                >+</span
                                            >
                                            <span
                                                class="cursor-pointer"
                                                :data-passage-id="passage.id"
                                                :data-piece-index="passageIndex"
                                                :data-run-index="runIndex"
                                                :class="
                                                    runClasses(
                                                        passage,
                                                        run,
                                                        runIndex,
                                                    )
                                                "
                                                :tabindex="
                                                    canEdit ? undefined : 0
                                                "
                                                :role="
                                                    canEdit
                                                        ? undefined
                                                        : 'button'
                                                "
                                                @mouseenter="
                                                    showReadings(
                                                        $event,
                                                        passage,
                                                        runIndex,
                                                    )
                                                "
                                                @mouseleave="hideReadings"
                                                @focus="
                                                    showReadings(
                                                        $event,
                                                        passage,
                                                        runIndex,
                                                    )
                                                "
                                                @blur="hideReadings"
                                                @click="
                                                    toggleRun(
                                                        passage.id,
                                                        runIndex,
                                                    )
                                                "
                                                @keydown.enter="
                                                    onRunKey(
                                                        passage.id,
                                                        runIndex,
                                                        $event,
                                                    )
                                                "
                                                @keydown.space="
                                                    onRunKey(
                                                        passage.id,
                                                        runIndex,
                                                        $event,
                                                    )
                                                "
                                                ><template
                                                    v-if="
                                                        run.extent_characters !==
                                                        null
                                                    "
                                                    >&lt;<span
                                                        class="inline-block border-b border-dotted border-stone-400 align-middle dark:border-stone-600"
                                                        :style="{
                                                            width: `${run.extent_characters}ch`,
                                                        }"
                                                    ></span
                                                    >&gt;</template
                                                ><template
                                                    v-else-if="run.text"
                                                    >{{ run.text }}</template
                                                ><span
                                                    v-else-if="run.omitted"
                                                    class="inline-block min-w-[1.5ch] px-1 text-center text-stone-400 dark:text-stone-500"
                                                    title="Nothing is printed here: another witness or a conjecture has words at this point which this edition omits"
                                                    >‸</span
                                                ><template v-else
                                                    >⟨insert⟩</template
                                                ></span
                                            ><span
                                                :data-spacer-passage-id="
                                                    passage.id
                                                "
                                                :data-spacer-run-index="
                                                    runIndex
                                                "
                                                :class="
                                                    spacerClasses(
                                                        passage,
                                                        runIndex,
                                                    )
                                                "
                                                >{{ ' ' }}</span
                                            >
                                        </template>
                                        <span
                                            v-if="showsBoundaries(passage)"
                                            contenteditable="false"
                                            class="mx-0.5 cursor-pointer rounded bg-amber-100 px-1 align-middle font-sans text-xs leading-normal text-amber-700 select-none hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                                            title="Insert a lacuna here"
                                            @click="
                                                toggleBoundary(
                                                    passage.id,
                                                    passage.runs.length,
                                                )
                                            "
                                            >+</span
                                        >
                                    </template>

                                    <button
                                        v-if="
                                            canEdit &&
                                            lacunaMode &&
                                            !registering
                                        "
                                        type="button"
                                        contenteditable="false"
                                        class="mr-1 rounded bg-amber-100 px-1 align-middle font-sans text-xs leading-normal text-amber-700 select-none hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                                        title="Insert a whole-line lacuna after this passage"
                                        @click="
                                            toggleNewPassage(
                                                passage.id,
                                                passage.edition_passage_id,
                                            )
                                        "
                                    >
                                        + line
                                    </button>

                                    <!-- One popover per passage, rendered after the whole
                        line — never splits the running text mid-line. Sits
                        outside the base/runs branches above so it can still
                        render for kind=new_passage even when this passage
                        itself has no base or runs of its own yet. -->
                                    <span
                                        v-if="
                                            part === 1 &&
                                            openTarget &&
                                            openTarget.passageId === passage.id
                                        "
                                        contenteditable="false"
                                        class="my-2 block w-full rounded border p-2 font-sans text-xs whitespace-normal"
                                        :class="
                                            openTarget.kind === 'boundary'
                                                ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'
                                                : 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950'
                                        "
                                    >
                                        <!-- The panels the number chip opens
                                    close by pressing the number again — no
                                    Cancel needed; the others are opened from
                                    buttons that don't read as toggles. -->
                                        <div
                                            v-if="openTarget.kind !== 'line'"
                                            class="mb-2 flex justify-end"
                                        >
                                            <button
                                                type="button"
                                                class="text-stone-500 underline hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                                                @click="closePopover"
                                            >
                                                Cancel
                                            </button>
                                        </div>

                                        <!-- Insert lacuna -->
                                        <template
                                            v-if="
                                                openTarget.kind === 'boundary'
                                            "
                                        >
                                            <p
                                                class="mb-1 text-stone-500 dark:text-stone-400"
                                            >
                                                A lacuna doesn't replace any
                                                text — it's inserted here,
                                                between the surrounding words.
                                            </p>
                                            <ul
                                                v-if="
                                                    unplacedLacunasFor(passage)
                                                        .length
                                                "
                                                class="mb-2 flex flex-col gap-1"
                                            >
                                                <li
                                                    v-for="conjecture in unplacedLacunasFor(
                                                        passage,
                                                    )"
                                                    :key="conjecture.id"
                                                    class="rounded p-1 hover:bg-white dark:hover:bg-stone-900"
                                                >
                                                    <button
                                                        type="button"
                                                        class="text-left"
                                                        @click="
                                                            pickUnplacedLacuna(
                                                                passage,
                                                                boundaryBefore(
                                                                    passage.runs,
                                                                    openTarget.index,
                                                                ),
                                                                conjecture.id,
                                                            )
                                                        "
                                                    >
                                                        <strong>{{
                                                            conjecture.label
                                                        }}</strong>
                                                    </button>
                                                </li>
                                            </ul>
                                            <div class="flex flex-col gap-1">
                                                <input
                                                    v-model="lacunaDraft.extent"
                                                    type="text"
                                                    placeholder="Extent (e.g. one line — optional)"
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                />
                                                <input
                                                    v-model.number="
                                                        lacunaDraft.extent_characters
                                                    "
                                                    type="number"
                                                    min="0"
                                                    placeholder="Estimated extent (characters)"
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                />
                                                <div
                                                    class="flex flex-wrap gap-1"
                                                >
                                                    <input
                                                        v-model="
                                                            lacunaDraft.proposed_by
                                                        "
                                                        type="text"
                                                        placeholder="First proposed by"
                                                        class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                    />
                                                    <ReferencePicker
                                                        v-model="
                                                            lacunaDraft.references
                                                        "
                                                        class="w-full"
                                                        :registry="
                                                            props
                                                                .bibliographyForm
                                                                .registry
                                                        "
                                                        :suggestions="
                                                            props
                                                                .bibliographyForm
                                                                .suggestions
                                                        "
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    class="self-start rounded bg-stone-900 px-2 py-1 text-white dark:bg-stone-100 dark:text-stone-900"
                                                    @click="
                                                        submitNewLacuna(
                                                            passage,
                                                            boundaryBefore(
                                                                passage.runs,
                                                                openTarget.index,
                                                            ),
                                                        )
                                                    "
                                                >
                                                    Insert lacuna
                                                </button>
                                            </div>
                                        </template>

                                        <!-- Select variant -->
                                        <template
                                            v-else-if="
                                                openTarget.kind === 'run'
                                            "
                                        >
                                            <template
                                                v-for="run in [
                                                    passage.runs[
                                                        openTarget.index
                                                    ],
                                                ]"
                                                :key="run.lemma_id ?? 'gap'"
                                            >
                                                <p
                                                    v-if="run.gap"
                                                    class="mb-1 text-stone-500 dark:text-stone-400"
                                                >
                                                    No witness covers this whole
                                                    passage under the current
                                                    base &mdash; pick a starting
                                                    point:
                                                </p>
                                                <!-- Only a run collapsed by a chosen
                                             reading can be reverted: reverting
                                             deletes that choice. A run
                                             collapsed because the base's own
                                             wording spans these columns has no
                                             choice behind it, and nothing to
                                             undo. -->
                                                <p
                                                    v-if="
                                                        canEdit &&
                                                        run.range_end_lemma_id !==
                                                            null &&
                                                        run.decided
                                                    "
                                                    class="mb-2"
                                                >
                                                    <button
                                                        type="button"
                                                        class="text-red-600 underline dark:text-red-400"
                                                        @click="
                                                            revertRange(run)
                                                        "
                                                    >
                                                        Revert to per-word view
                                                    </button>
                                                </p>
                                                <ul
                                                    class="mb-2 flex flex-col gap-1"
                                                >
                                                    <li
                                                        v-for="candidate in popoverCandidates(
                                                            passage,
                                                            openTarget.index,
                                                        )"
                                                        :key="candidate.key"
                                                        class="flex flex-wrap items-center justify-between gap-2 rounded p-1"
                                                        :class="
                                                            candidate.selected
                                                                ? 'bg-emerald-100 dark:bg-emerald-950/50'
                                                                : 'hover:bg-white dark:hover:bg-stone-900'
                                                        "
                                                    >
                                                        <!-- The name of a conjecture opens it
                                                         (edit form for editors, literature
                                                         for readers); the reading itself
                                                         picks it. -->
                                                        <button
                                                            v-if="
                                                                candidate.conjecture_id !==
                                                                null
                                                            "
                                                            type="button"
                                                            class="shrink-0 font-bold underline decoration-stone-300 dark:decoration-stone-700"
                                                            :title="
                                                                canEdit
                                                                    ? 'Edit this conjecture'
                                                                    : 'Its literature'
                                                            "
                                                            @click="
                                                                toggleConjecture(
                                                                    candidate.conjecture_id,
                                                                )
                                                            "
                                                        >
                                                            {{
                                                                candidate.label
                                                            }}:
                                                        </button>
                                                        <strong
                                                            v-else
                                                            class="shrink-0"
                                                            >{{
                                                                candidate.label
                                                            }}:</strong
                                                        >
                                                        <button
                                                            type="button"
                                                            class="flex-1 text-left"
                                                            :disabled="!canEdit"
                                                            @click="
                                                                candidate.conjecture_id !==
                                                                null
                                                                    ? pickConjecture(
                                                                          passage,
                                                                          candidate.anchorRun,
                                                                          candidate.conjecture_id,
                                                                      )
                                                                    : pickWitness(
                                                                          passage,
                                                                          candidate.anchorRun,
                                                                          candidate,
                                                                      )
                                                            "
                                                        >
                                                            {{
                                                                candidateSummary(
                                                                    candidate,
                                                                )
                                                            }}
                                                            <span
                                                                v-if="
                                                                    candidate.needs_review
                                                                "
                                                                class="rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                                                title="The transcription text this reading was collated from has since been edited — picking it confirms it still says what the manuscript says and clears this flag; picking another candidate re-chooses."
                                                                >needs
                                                                review</span
                                                            >

                                                            <em
                                                                v-if="
                                                                    candidate.note
                                                                "
                                                                >&mdash;
                                                                {{
                                                                    candidate.note
                                                                }}</em
                                                            >
                                                        </button>
                                                        <span
                                                            v-if="
                                                                candidate.selected
                                                            "
                                                            class="text-emerald-700 dark:text-emerald-400"
                                                            >selected</span
                                                        >
                                                        <!-- The reading itself is clickable
                                                         too, but a reading that is
                                                         a word, "omitted" or
                                                         "deleted" does not look like
                                                         a control — so the decision
                                                         is spelled out. -->
                                                        <button
                                                            v-else-if="canEdit"
                                                            type="button"
                                                            class="rounded border border-stone-300 px-1.5 text-xs dark:border-stone-700"
                                                            title="Print this reading in the edition"
                                                            @click="
                                                                candidate.conjecture_id !==
                                                                null
                                                                    ? pickConjecture(
                                                                          passage,
                                                                          candidate.anchorRun,
                                                                          candidate.conjecture_id,
                                                                      )
                                                                    : pickWitness(
                                                                          passage,
                                                                          candidate.anchorRun,
                                                                          candidate,
                                                                      )
                                                            "
                                                        >
                                                            Adopt
                                                        </button>
                                                        <div
                                                            v-if="
                                                                candidate.conjecture_id !==
                                                                    null &&
                                                                openConjectureId ===
                                                                    candidate.conjecture_id
                                                            "
                                                            class="w-full"
                                                        >
                                                            <div
                                                                v-if="
                                                                    openConjectureId !==
                                                                        null &&
                                                                    conjectureById(
                                                                        openConjectureId,
                                                                    )
                                                                "
                                                                class="mt-2 border-l-2 border-sky-200 pl-3 dark:border-sky-900"
                                                            >
                                                                <ConjectureForm
                                                                    v-if="
                                                                        canEdit
                                                                    "
                                                                    :passages="
                                                                        props.workPassages
                                                                    "
                                                                    :levels="
                                                                        props.referenceLevels
                                                                    "
                                                                    :lacunas="
                                                                        lacunasForForm
                                                                    "
                                                                    :conjecture="
                                                                        conjectureById(
                                                                            openConjectureId,
                                                                        )
                                                                    "
                                                                    :registry="
                                                                        props
                                                                            .bibliographyForm
                                                                            .registry
                                                                    "
                                                                    :suggestions="
                                                                        props
                                                                            .bibliographyForm
                                                                            .suggestions
                                                                    "
                                                                    @saved="
                                                                        openConjectureId =
                                                                            null
                                                                    "
                                                                    @cancel="
                                                                        openConjectureId =
                                                                            null
                                                                    "
                                                                />
                                                                <template
                                                                    v-else
                                                                >
                                                                    <p
                                                                        v-if="
                                                                            conjectureBibliography(
                                                                                conjectureById(
                                                                                    openConjectureId,
                                                                                )!,
                                                                            )
                                                                                .length ===
                                                                            0
                                                                        "
                                                                        class="text-stone-500 dark:text-stone-400"
                                                                    >
                                                                        No
                                                                        literature
                                                                        recorded
                                                                        for this
                                                                        conjecture.
                                                                    </p>
                                                                    <p
                                                                        v-for="entry in conjectureBibliography(
                                                                            conjectureById(
                                                                                openConjectureId,
                                                                            )!,
                                                                        )"
                                                                        :key="
                                                                            entry.id
                                                                        "
                                                                        class="mb-1 text-stone-600 dark:text-stone-400"
                                                                    >
                                                                        <span
                                                                            class="font-medium"
                                                                            >{{
                                                                                entry.citation
                                                                            }}</span
                                                                        >
                                                                        <template
                                                                            v-if="
                                                                                entry.reference
                                                                            "
                                                                        >
                                                                            —
                                                                            <template
                                                                                v-for="(
                                                                                    run,
                                                                                    index
                                                                                ) in entry.reference"
                                                                                :key="
                                                                                    index
                                                                                "
                                                                            >
                                                                                <em
                                                                                    v-if="
                                                                                        run.italic
                                                                                    "
                                                                                    >{{
                                                                                        run.text
                                                                                    }}</em
                                                                                >
                                                                                <template
                                                                                    v-else
                                                                                    >{{
                                                                                        run.text
                                                                                    }}</template
                                                                                >
                                                                            </template>
                                                                        </template>
                                                                    </p>
                                                                    <p
                                                                        v-if="
                                                                            conjectureById(
                                                                                openConjectureId,
                                                                            )!
                                                                                .note
                                                                        "
                                                                        class="text-stone-500 italic dark:text-stone-400"
                                                                    >
                                                                        {{
                                                                            conjectureById(
                                                                                openConjectureId,
                                                                            )!
                                                                                .note
                                                                        }}
                                                                    </p>
                                                                </template>
                                                            </div>
                                                        </div>
                                                    </li>
                                                </ul>

                                                <template
                                                    v-if="canEdit && !run.gap"
                                                >
                                                    <ul
                                                        v-if="
                                                            unplacedForRun(
                                                                passage,
                                                                run,
                                                            ).length
                                                        "
                                                        class="mb-2 flex flex-col gap-1"
                                                    >
                                                        <li
                                                            v-for="conjecture in unplacedForRun(
                                                                passage,
                                                                run,
                                                            )"
                                                            :key="conjecture.id"
                                                            class="flex items-center justify-between gap-2 rounded p-1 hover:bg-white dark:hover:bg-stone-900"
                                                        >
                                                            <button
                                                                type="button"
                                                                class="flex-1 text-left"
                                                                @click="
                                                                    pickConjecture(
                                                                        passage,
                                                                        run,
                                                                        conjecture.id,
                                                                    )
                                                                "
                                                            >
                                                                <strong
                                                                    >{{
                                                                        conjecture.label
                                                                    }}:</strong
                                                                >
                                                                {{
                                                                    conjecture.text
                                                                }}
                                                            </button>
                                                        </li>
                                                    </ul>
                                                    <div
                                                        v-if="
                                                            lacunaCandidateOf(
                                                                run,
                                                            )
                                                        "
                                                        class="flex flex-col gap-1"
                                                    >
                                                        <p
                                                            class="text-stone-500 dark:text-stone-400"
                                                        >
                                                            Propose a supplement
                                                            for this lacuna:
                                                        </p>
                                                        <input
                                                            v-model="
                                                                conjectureDraft.text
                                                            "
                                                            type="text"
                                                            placeholder="Proposed supplement"
                                                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                        />
                                                        <div
                                                            class="flex flex-wrap gap-1"
                                                        >
                                                            <input
                                                                v-model="
                                                                    conjectureDraft.proposed_by
                                                                "
                                                                type="text"
                                                                placeholder="First proposed by"
                                                                class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                            />
                                                            <ReferencePicker
                                                                v-model="
                                                                    conjectureDraft.references
                                                                "
                                                                class="w-full"
                                                                :registry="
                                                                    props
                                                                        .bibliographyForm
                                                                        .registry
                                                                "
                                                                :suggestions="
                                                                    props
                                                                        .bibliographyForm
                                                                        .suggestions
                                                                "
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            class="self-start rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                                            :disabled="
                                                                !conjectureDraft.text
                                                            "
                                                            @click="
                                                                submitSupplementForRun(
                                                                    passage,
                                                                    run,
                                                                )
                                                            "
                                                        >
                                                            Add supplement
                                                        </button>
                                                    </div>
                                                </template>
                                            </template>
                                        </template>

                                        <!-- Add conjecture -->
                                        <template
                                            v-else-if="
                                                openTarget.kind === 'range'
                                            "
                                        >
                                            <p
                                                class="mb-2 text-stone-500 dark:text-stone-400"
                                            >
                                                {{
                                                    conjectureDraft.deletion
                                                        ? 'Deleting'
                                                        : 'Replacing'
                                                }}
                                                <strong>{{
                                                    rangeSelectionText(
                                                        passage,
                                                        openTarget,
                                                    )
                                                }}</strong>
                                                {{
                                                    conjectureDraft.deletion
                                                        ? ''
                                                        : 'with:'
                                                }}
                                            </p>
                                            <div class="flex flex-col gap-1">
                                                <input
                                                    v-model="
                                                        conjectureDraft.text
                                                    "
                                                    type="text"
                                                    placeholder="Proposed text"
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 disabled:opacity-50 dark:border-stone-700"
                                                    :disabled="
                                                        conjectureDraft.deletion
                                                    "
                                                />
                                                <label
                                                    class="flex items-center gap-1 text-stone-600 dark:text-stone-400"
                                                    title="The conjecture is that these words should not be read at all — adopted, the edition prints nothing here"
                                                >
                                                    <input
                                                        v-model="
                                                            conjectureDraft.deletion
                                                        "
                                                        type="checkbox"
                                                    />
                                                    Delete these words
                                                </label>
                                                <div
                                                    class="flex flex-wrap gap-1"
                                                >
                                                    <input
                                                        v-model="
                                                            conjectureDraft.proposed_by
                                                        "
                                                        type="text"
                                                        placeholder="First proposed by"
                                                        class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                    />
                                                    <ReferencePicker
                                                        v-model="
                                                            conjectureDraft.references
                                                        "
                                                        class="w-full"
                                                        :registry="
                                                            props
                                                                .bibliographyForm
                                                                .registry
                                                        "
                                                        :suggestions="
                                                            props
                                                                .bibliographyForm
                                                                .suggestions
                                                        "
                                                    />
                                                </div>
                                                <span
                                                    class="flex flex-wrap items-center gap-2"
                                                >
                                                    <button
                                                        type="button"
                                                        class="rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                                        :disabled="
                                                            !conjectureDraft.text &&
                                                            !conjectureDraft.deletion
                                                        "
                                                        title="Catalogue the conjecture as a candidate without changing the edition's text"
                                                        @click="
                                                            submitConjecture(
                                                                passage,
                                                                openTarget.startIndex,
                                                                openTarget.endIndex,
                                                                false,
                                                            )
                                                        "
                                                    >
                                                        Register
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="rounded border border-stone-300 px-2 py-1 disabled:opacity-50 dark:border-stone-700"
                                                        :disabled="
                                                            !conjectureDraft.text &&
                                                            !conjectureDraft.deletion
                                                        "
                                                        title="Catalogue the conjecture and print it in this edition"
                                                        @click="
                                                            submitConjecture(
                                                                passage,
                                                                openTarget.startIndex,
                                                                openTarget.endIndex,
                                                                true,
                                                            )
                                                        "
                                                    >
                                                        Register and adopt
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="ml-auto text-red-600 underline dark:text-red-400"
                                                        title="Remove the whole segment these words belong to from the edition"
                                                        @click="
                                                            removeEditionPassages(
                                                                [passage.id],
                                                            )
                                                        "
                                                    >
                                                        Remove segment from
                                                        edition
                                                    </button>
                                                </span>
                                            </div>
                                        </template>

                                        <!-- Remove from edition -->
                                        <template
                                            v-else-if="
                                                openTarget.kind === 'remove'
                                            "
                                        >
                                            <p
                                                class="mb-2 text-stone-500 dark:text-stone-400"
                                            >
                                                Remove
                                                <strong>{{
                                                    passageListLabel(
                                                        openTarget.passageIds,
                                                    )
                                                }}</strong>
                                                from this edition? The segments
                                                become available again in every
                                                witness citing them.
                                            </p>
                                            <button
                                                type="button"
                                                class="self-start rounded bg-red-600 px-2 py-1 text-white dark:bg-red-500"
                                                @click="
                                                    removeEditionPassages(
                                                        openTarget.passageIds,
                                                    )
                                                "
                                            >
                                                {{
                                                    openTarget.passageIds
                                                        .length > 1
                                                        ? 'Remove segments from edition'
                                                        : 'Remove segment from edition'
                                                }}
                                            </button>
                                        </template>

                                        <!-- The line's notice: what it rests on, then its
                                         variants (order disagreements and split
                                         citations), references and notes. Open to
                                         readers and editors alike. A conjecture named
                                         here opens in place: the edit form for editors,
                                         its literature for readers. -->
                                        <template
                                            v-else-if="
                                                openTarget.kind === 'line'
                                            "
                                        >
                                            <p
                                                v-for="line in provenanceLines(
                                                    passage,
                                                )"
                                                :key="line.text"
                                                class="mb-1 text-stone-700 dark:text-stone-300"
                                            >
                                                <button
                                                    v-if="
                                                        line.conjectureId !==
                                                        null
                                                    "
                                                    type="button"
                                                    class="underline decoration-stone-300 dark:decoration-stone-700"
                                                    :title="
                                                        canEdit
                                                            ? 'Edit this conjecture'
                                                            : 'Its literature'
                                                    "
                                                    @click="
                                                        toggleConjecture(
                                                            line.conjectureId,
                                                        )
                                                    "
                                                >
                                                    {{ line.text }}
                                                </button>
                                                <template v-else>{{
                                                    line.text
                                                }}</template>
                                            </p>
                                            <div
                                                v-if="
                                                    openConjectureId !== null &&
                                                    conjectureById(
                                                        openConjectureId,
                                                    )
                                                "
                                                class="mt-2 border-l-2 border-sky-200 pl-3 dark:border-sky-900"
                                            >
                                                <ConjectureForm
                                                    v-if="canEdit"
                                                    :passages="
                                                        props.workPassages
                                                    "
                                                    :levels="
                                                        props.referenceLevels
                                                    "
                                                    :lacunas="lacunasForForm"
                                                    :conjecture="
                                                        conjectureById(
                                                            openConjectureId,
                                                        )
                                                    "
                                                    :registry="
                                                        props.bibliographyForm
                                                            .registry
                                                    "
                                                    :suggestions="
                                                        props.bibliographyForm
                                                            .suggestions
                                                    "
                                                    @saved="
                                                        openConjectureId = null
                                                    "
                                                    @cancel="
                                                        openConjectureId = null
                                                    "
                                                />
                                                <template v-else>
                                                    <p
                                                        v-if="
                                                            conjectureBibliography(
                                                                conjectureById(
                                                                    openConjectureId,
                                                                )!,
                                                            ).length === 0
                                                        "
                                                        class="text-stone-500 dark:text-stone-400"
                                                    >
                                                        No literature recorded
                                                        for this conjecture.
                                                    </p>
                                                    <p
                                                        v-for="entry in conjectureBibliography(
                                                            conjectureById(
                                                                openConjectureId,
                                                            )!,
                                                        )"
                                                        :key="entry.id"
                                                        class="mb-1 text-stone-600 dark:text-stone-400"
                                                    >
                                                        <span
                                                            class="font-medium"
                                                            >{{
                                                                entry.citation
                                                            }}</span
                                                        >
                                                        <template
                                                            v-if="
                                                                entry.reference
                                                            "
                                                        >
                                                            —
                                                            <template
                                                                v-for="(
                                                                    run, index
                                                                ) in entry.reference"
                                                                :key="index"
                                                            >
                                                                <em
                                                                    v-if="
                                                                        run.italic
                                                                    "
                                                                    >{{
                                                                        run.text
                                                                    }}</em
                                                                >
                                                                <template
                                                                    v-else
                                                                    >{{
                                                                        run.text
                                                                    }}</template
                                                                >
                                                            </template>
                                                        </template>
                                                    </p>
                                                    <p
                                                        v-if="
                                                            conjectureById(
                                                                openConjectureId,
                                                            )!.note
                                                        "
                                                        class="text-stone-500 italic dark:text-stone-400"
                                                    >
                                                        {{
                                                            conjectureById(
                                                                openConjectureId,
                                                            )!.note
                                                        }}
                                                    </p>
                                                </template>
                                            </div>

                                            <template
                                                v-if="
                                                    splitVariants(passage)
                                                        .length > 0 ||
                                                    (passage.order_range &&
                                                        panelCandidates(
                                                            passage.order_range,
                                                            passage,
                                                        ).length > 0)
                                                "
                                            >
                                                <p
                                                    class="mt-2 mb-1 text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
                                                >
                                                    Variants
                                                </p>
                                                <template
                                                    v-for="witness in splitVariants(
                                                        passage,
                                                    )"
                                                    :key="witness.siglum"
                                                >
                                                    <p
                                                        v-for="line in discontinuityLines(
                                                            witness,
                                                        )"
                                                        :key="line"
                                                        class="mb-1 text-stone-600 dark:text-stone-400"
                                                    >
                                                        {{ line }}
                                                    </p>
                                                    <!-- A registered proposal that divides
                                                         the line is adopted from here, like
                                                         a whole-line one from the list below. -->
                                                    <p
                                                        v-if="
                                                            witness.conjecture_id !==
                                                                null && canEdit
                                                        "
                                                        class="mb-1"
                                                    >
                                                        <button
                                                            type="button"
                                                            class="rounded border border-stone-300 px-2 py-0.5 dark:border-stone-700"
                                                            title="Print the line in pieces as this proposal reads it"
                                                            @click="
                                                                adoptArrangement(
                                                                    witness.conjecture_id,
                                                                )
                                                            "
                                                        >
                                                            Adopt
                                                        </button>
                                                    </p>
                                                </template>
                                                <template
                                                    v-if="passage.order_range"
                                                >
                                                    <ul
                                                        class="mb-2 flex flex-col gap-2"
                                                    >
                                                        <li
                                                            v-for="candidate in panelCandidates(
                                                                passage.order_range,
                                                                passage,
                                                            )"
                                                            :key="`${candidate.source}-${candidate.transcription_layer_id ?? candidate.conjecture_id}`"
                                                            class="rounded p-1"
                                                            :class="
                                                                candidate.matches_current
                                                                    ? 'bg-emerald-100 dark:bg-emerald-950/50'
                                                                    : 'hover:bg-white dark:hover:bg-stone-900'
                                                            "
                                                        >
                                                            <div
                                                                class="flex items-center justify-between gap-2"
                                                            >
                                                                <span>
                                                                    <strong>{{
                                                                        candidateName(
                                                                            candidate,
                                                                        )
                                                                    }}</strong>
                                                                    <em
                                                                        v-if="
                                                                            candidate.source ===
                                                                            'conjecture'
                                                                        "
                                                                    >
                                                                        (conjecture)</em
                                                                    >:
                                                                    <template
                                                                        v-if="
                                                                            !candidate.matches_current
                                                                        "
                                                                    >
                                                                        {{
                                                                            analyzeSequence(
                                                                                passage
                                                                                    .order_range
                                                                                    .current_sequence,
                                                                                candidate.sequence,
                                                                                labelBeforeRange(
                                                                                    passage.order_range,
                                                                                ),
                                                                            )
                                                                                .text
                                                                        }}
                                                                    </template>
                                                                    <span
                                                                        v-else
                                                                        class="text-emerald-700 dark:text-emerald-400"
                                                                        >matches
                                                                        the
                                                                        edition's
                                                                        order</span
                                                                    >
                                                                </span>
                                                                <button
                                                                    v-if="
                                                                        canEdit &&
                                                                        !candidate.matches_current
                                                                    "
                                                                    type="button"
                                                                    class="text-stone-700 underline dark:text-stone-300"
                                                                    @click="
                                                                        chooseOrder(
                                                                            passage.order_range,
                                                                            candidate,
                                                                        )
                                                                    "
                                                                >
                                                                    Adopt
                                                                </button>
                                                                <button
                                                                    v-else-if="
                                                                        candidate.conjecture_id !==
                                                                            null &&
                                                                        !adoptedConjectureIds.has(
                                                                            candidate.conjecture_id,
                                                                        )
                                                                    "
                                                                    type="button"
                                                                    class="text-stone-700 underline dark:text-stone-300"
                                                                    title="The edition's order already matches this proposal — record that this edition adopts it"
                                                                    @click="
                                                                        chooseOrder(
                                                                            passage.order_range,
                                                                            candidate,
                                                                        )
                                                                    "
                                                                >
                                                                    Record as
                                                                    adopted
                                                                </button>
                                                            </div>
                                                        </li>
                                                    </ul>
                                                    <template v-if="canEdit">
                                                        <button
                                                            v-if="
                                                                !proposalDraft.open
                                                            "
                                                            type="button"
                                                            class="text-stone-700 underline dark:text-stone-300"
                                                            @click="
                                                                openProposalDraft(
                                                                    passage.order_range,
                                                                )
                                                            "
                                                        >
                                                            Register another
                                                            proposed order…
                                                        </button>
                                                        <div
                                                            v-else
                                                            class="flex flex-col gap-1"
                                                        >
                                                            <p
                                                                class="text-stone-500 dark:text-stone-400"
                                                            >
                                                                Arrange
                                                                {{
                                                                    passage
                                                                        .order_range
                                                                        .range_label
                                                                }}
                                                                as the proposal
                                                                reads it,
                                                                credited below —
                                                                then adopt it,
                                                                or only register
                                                                it as a
                                                                candidate.
                                                            </p>
                                                            <ol
                                                                class="flex flex-col gap-1"
                                                            >
                                                                <li
                                                                    v-for="(
                                                                        entry,
                                                                        entryIndex
                                                                    ) in proposalDraft.order"
                                                                    :key="
                                                                        entry.id
                                                                    "
                                                                    class="flex items-center justify-between gap-2 rounded border border-stone-200 px-2 py-1 dark:border-stone-800"
                                                                >
                                                                    <span>{{
                                                                        entry.label
                                                                    }}</span>
                                                                    <span
                                                                        class="flex gap-2"
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            class="underline disabled:opacity-30"
                                                                            :disabled="
                                                                                entryIndex ===
                                                                                0
                                                                            "
                                                                            @click="
                                                                                moveProposalEntry(
                                                                                    entryIndex,
                                                                                    -1,
                                                                                )
                                                                            "
                                                                        >
                                                                            &uarr;
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            class="underline disabled:opacity-30"
                                                                            :disabled="
                                                                                entryIndex ===
                                                                                proposalDraft
                                                                                    .order
                                                                                    .length -
                                                                                    1
                                                                            "
                                                                            @click="
                                                                                moveProposalEntry(
                                                                                    entryIndex,
                                                                                    1,
                                                                                )
                                                                            "
                                                                        >
                                                                            &darr;
                                                                        </button>
                                                                    </span>
                                                                </li>
                                                            </ol>
                                                            <input
                                                                v-model="
                                                                    proposalDraft.proposed_by
                                                                "
                                                                type="text"
                                                                placeholder="First proposed by"
                                                                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                            />
                                                            <ReferencePicker
                                                                v-model="
                                                                    proposalDraft.references
                                                                "
                                                                class="w-full"
                                                                :registry="
                                                                    props
                                                                        .bibliographyForm
                                                                        .registry
                                                                "
                                                                :suggestions="
                                                                    props
                                                                        .bibliographyForm
                                                                        .suggestions
                                                                "
                                                            />
                                                            <span
                                                                class="flex items-center gap-2"
                                                            >
                                                                <button
                                                                    type="button"
                                                                    class="self-start rounded bg-stone-900 px-2 py-1 text-white dark:bg-stone-100 dark:text-stone-900"
                                                                    @click="
                                                                        submitOrderProposal(
                                                                            true,
                                                                        )
                                                                    "
                                                                >
                                                                    Register and
                                                                    adopt
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    class="self-start rounded border border-stone-300 px-2 py-1 dark:border-stone-700"
                                                                    title="Catalogue the proposal as a candidate without changing the edition's order"
                                                                    @click="
                                                                        submitOrderProposal(
                                                                            false,
                                                                        )
                                                                    "
                                                                >
                                                                    Register
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    class="text-stone-500 underline"
                                                                    @click="
                                                                        closeProposalDraft
                                                                    "
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </span>
                                                        </div>
                                                    </template>
                                                </template>
                                            </template>
                                        </template>

                                        <!-- Insert a whole-line lacuna -->
                                        <template
                                            v-else-if="
                                                openTarget.kind ===
                                                'new_passage'
                                            "
                                        >
                                            <p
                                                class="mb-1 text-stone-500 dark:text-stone-400"
                                            >
                                                A whole-line lacuna has no
                                                manuscript witness of its own —
                                                name the line it should occupy
                                                (e.g. "80A") and it becomes its
                                                own passage.
                                            </p>
                                            <div class="flex flex-col gap-1">
                                                <input
                                                    v-model="lacunaDraft.label"
                                                    type="text"
                                                    placeholder="Line label (e.g. 80A)"
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                />
                                                <input
                                                    v-model="lacunaDraft.extent"
                                                    type="text"
                                                    placeholder="Extent (e.g. one line — optional)"
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                />
                                                <input
                                                    v-model.number="
                                                        lacunaDraft.extent_characters
                                                    "
                                                    type="number"
                                                    min="0"
                                                    placeholder="Estimated extent (characters)"
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                />
                                                <div
                                                    class="flex flex-wrap gap-1"
                                                >
                                                    <input
                                                        v-model="
                                                            lacunaDraft.proposed_by
                                                        "
                                                        type="text"
                                                        placeholder="First proposed by"
                                                        class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                    />
                                                    <ReferencePicker
                                                        v-model="
                                                            lacunaDraft.references
                                                        "
                                                        class="w-full"
                                                        :registry="
                                                            props
                                                                .bibliographyForm
                                                                .registry
                                                        "
                                                        :suggestions="
                                                            props
                                                                .bibliographyForm
                                                                .suggestions
                                                        "
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    class="self-start rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                                    :disabled="
                                                        !lacunaDraft.label
                                                    "
                                                    @click="
                                                        submitWholeLineLacuna()
                                                    "
                                                >
                                                    Insert whole-line lacuna
                                                </button>
                                            </div>
                                        </template>

                                        <!-- The line's literature, in the same
                                    notice as its notes: readable by everyone,
                                    edited in place by editors. -->
                                        <div
                                            v-if="
                                                openTarget.kind === 'line' &&
                                                (canEdit ||
                                                    passage.references.length >
                                                        0)
                                            "
                                            class="mt-2 border-l-2 border-stone-200 pl-3 dark:border-stone-800"
                                        >
                                            <p
                                                class="mb-1 text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
                                            >
                                                References
                                            </p>
                                            <ReferencePicker
                                                :target="{
                                                    edition_id:
                                                        props.edition.id,
                                                    canonical_passage_id:
                                                        passage.id,
                                                }"
                                                :references="passage.references"
                                                :registry="
                                                    props.bibliographyForm
                                                        .registry
                                                "
                                                :suggestions="
                                                    props.bibliographyForm
                                                        .suggestions
                                                "
                                                :readonly="!canEdit"
                                            />
                                        </div>

                                        <!-- The line's notes belong to the same
                                    notice the number opens — readable by
                                    everyone, whichever report opened it;
                                    only editing them is gated. -->
                                        <div
                                            v-if="
                                                openTarget.kind === 'line' &&
                                                passage.comments.length > 0
                                            "
                                            class="mt-2 border-l-2 border-stone-200 pl-3 dark:border-stone-800"
                                        >
                                            <p
                                                class="mb-1 text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
                                            >
                                                Notes
                                            </p>
                                            <p
                                                v-for="comment in passage.comments"
                                                :key="comment.id"
                                                class="mb-1 text-stone-600 dark:text-stone-400"
                                            >
                                                <em
                                                    v-if="
                                                        noteAnchorText(
                                                            passage,
                                                            comment,
                                                        )
                                                    "
                                                    class="text-stone-800 dark:text-stone-200"
                                                    >{{
                                                        noteAnchorText(
                                                            passage,
                                                            comment,
                                                        )
                                                    }}]
                                                </em>
                                                <template
                                                    v-if="
                                                        editingNoteId !==
                                                        comment.id
                                                    "
                                                >
                                                    {{ comment.note }}
                                                    <span class="text-stone-400"
                                                        >—
                                                        {{
                                                            comment.author
                                                        }}</span
                                                    >
                                                    <button
                                                        v-if="canEdit"
                                                        type="button"
                                                        class="ml-2 text-xs underline"
                                                        @click="
                                                            startEditingNote(
                                                                comment,
                                                            )
                                                        "
                                                    >
                                                        edit
                                                    </button>
                                                    <button
                                                        v-if="canEdit"
                                                        type="button"
                                                        class="ml-1 text-xs text-red-600 underline dark:text-red-400"
                                                        @click="
                                                            removeNote(comment)
                                                        "
                                                    >
                                                        delete
                                                    </button>
                                                </template>
                                            </p>

                                            <div
                                                v-if="
                                                    canEdit &&
                                                    editingNoteId !== null
                                                "
                                                class="mt-1 flex flex-col gap-1"
                                            >
                                                <textarea
                                                    v-model="noteDraft"
                                                    rows="2"
                                                    placeholder="Reword this note"
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                ></textarea>
                                                <span
                                                    class="flex items-center gap-2"
                                                >
                                                    <button
                                                        type="button"
                                                        class="rounded bg-stone-900 px-2 py-0.5 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                                        :disabled="
                                                            !noteDraft.trim()
                                                        "
                                                        @click="
                                                            saveNote(passage)
                                                        "
                                                    >
                                                        Save note
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="text-stone-500 underline"
                                                        @click="cancelNote"
                                                    >
                                                        Cancel
                                                    </button>
                                                </span>
                                            </div>
                                        </div>

                                        <span
                                            v-if="submitError"
                                            class="mt-1 block text-red-600 dark:text-red-400"
                                            >{{ submitError }}</span
                                        >

                                        <!-- A note belongs with the other things one
                                     can say about the selected words, not
                                     beside the line. Anchored by noteAnchor()
                                     to whatever this panel is open on — one
                                     column, a range, or the line as a whole. -->
                                        <template v-if="canEdit">
                                            <button
                                                v-if="
                                                    notingPassageId !==
                                                    passage.id
                                                "
                                                type="button"
                                                class="mt-2 block text-stone-500 underline dark:text-stone-400"
                                                @click="
                                                    openNoteComposer(passage)
                                                "
                                            >
                                                + Note
                                            </button>

                                            <div
                                                v-else
                                                class="mt-2 flex flex-col gap-1"
                                            >
                                                <textarea
                                                    v-model="noteDraft"
                                                    rows="2"
                                                    :placeholder="
                                                        noteAnchor(passage)
                                                            .lemma_id !== null
                                                            ? 'Note on the selected words'
                                                            : 'Note on this line'
                                                    "
                                                    class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                                ></textarea>
                                                <span
                                                    class="flex items-center gap-2"
                                                >
                                                    <button
                                                        type="button"
                                                        class="rounded bg-stone-900 px-2 py-0.5 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                                        :disabled="
                                                            !noteDraft.trim()
                                                        "
                                                        @click="
                                                            saveNote(passage)
                                                        "
                                                    >
                                                        Save note
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="text-stone-500 underline"
                                                        @click="cancelNote"
                                                    >
                                                        Cancel
                                                    </button>
                                                </span>
                                            </div>
                                        </template>
                                    </span>
                                </article>
                            </template>
                        </div>
                        <!-- What the current tool wants of the user — below the
                             text, so the text box itself never moves. -->
                        <p
                            v-if="canEdit"
                            class="mt-2 flex flex-wrap items-center gap-3 text-stone-500 empty:hidden dark:text-stone-400"
                        >
                            <span v-if="lacunaMode">
                                Click a marker between two words to insert a
                                lacuna there.
                            </span>
                            <span v-if="textFocused">
                                Line breaks work as in an editor: Enter breaks
                                the line after the word at the caret, Enter
                                again opens a paragraph, Backspace and Delete
                                join lines. The words themselves cannot be
                                edited here.
                            </span>
                        </p>
                    </fieldset>
                </div>

                <!-- The witnesses pane: the manuscripts beside the edition's
                own continuous text, and where segments are picked for it. -->
                <WitnessesPanel
                    :edition="props.edition"
                    :transcripts="props.witnessTranscripts"
                    :already-added-passage-ids="alreadyAddedPassageIds"
                    :passages="props.workPassages"
                    :reference-levels="props.referenceLevels"
                    :can-edit="canEdit"
                    :locked="registering"
                    :hovered-spans="hoveredSpans"
                    :hovered-passage-id="hoveredEditionPassageId"
                    @hover-image-region="onImageRegionHover"
                />
            </div>

            <!-- The literature the apparatus draws on: every item cited by
                 a passage of this edition or by a conjecture placed on one,
                 anchored so a citation can link to its entry. -->
            <section
                v-if="props.bibliography.length > 0"
                class="mt-2 mb-6 rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800"
            >
                <div class="mb-2 flex items-baseline justify-between gap-3">
                    <h3
                        class="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
                    >
                        Bibliography
                    </h3>
                    <a
                        :href="exportEditionBibliography.url(props.edition.id)"
                        class="text-xs text-stone-500 underline dark:text-stone-400"
                        >Download as .bib</a
                    >
                </div>
                <ol class="flex flex-col gap-1">
                    <li
                        v-for="entry in props.bibliography"
                        :id="`bibliography-${entry.id}`"
                        :key="entry.id"
                        class="pl-6 -indent-6 text-stone-700 dark:text-stone-300"
                    >
                        <template
                            v-for="(run, index) in entry.reference"
                            :key="index"
                        >
                            <em v-if="run.italic">{{ run.text }}</em>
                            <template v-else>{{ run.text }}</template>
                        </template>
                    </li>
                </ol>
            </section>
        </div>

        <!-- What the tradition has at the word under the cursor. Shown for
             every word, not only the disputed ones: "all three manuscripts
             agree here" is an answer a reader may want too. -->
        <div
            v-if="hovered"
            class="pointer-events-none fixed z-30 max-w-md rounded border border-stone-300 bg-white px-3 py-2 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900"
            :style="{
                left: `${hovered.left}px`,
                top: hovered.top !== null ? `${hovered.top}px` : undefined,
                bottom:
                    hovered.bottom !== null ? `${hovered.bottom}px` : undefined,
            }"
        >
            <p
                v-for="group in witnessReadings(hovered.run)"
                :key="`w-${group.text}`"
                class="flex gap-2"
            >
                <span
                    :class="[
                        group.printed ? 'font-medium' : '',
                        group.omitted ? 'italic' : '',
                    ]"
                    >{{ group.text }}</span
                >
                <span class="text-stone-500 dark:text-stone-400">{{
                    group.sigla.join(' ')
                }}</span>
            </p>

            <p
                v-for="candidate in conjectureCandidates(hovered.run)"
                :key="`c-${candidate.key}`"
                class="flex gap-2 text-sky-800 dark:text-sky-300"
            >
                <span
                    :class="[
                        candidate.selected ? 'font-medium' : '',
                        candidate.omitted ? 'italic' : '',
                    ]"
                    >{{ candidateText(candidate) }}</span
                >
                <span class="text-stone-500 dark:text-stone-400">{{
                    candidate.label
                }}</span>
            </p>

            <p
                v-if="differenceProvenance(hovered.run)"
                class="mt-1 text-xs text-amber-700 dark:text-amber-400"
            >
                {{ differenceProvenance(hovered.run) }}
            </p>

            <template
                v-if="
                    !canEdit &&
                    notesFor(hovered.passage, hovered.run).length > 0
                "
            >
                <hr class="my-1 border-stone-200 dark:border-stone-800" />
                <p
                    v-for="comment in notesFor(hovered.passage, hovered.run)"
                    :key="`n-${comment.id}`"
                    class="text-stone-600 dark:text-stone-400"
                >
                    {{ comment.note }}
                    <span class="text-stone-400">— {{ comment.author }}</span>
                </p>
            </template>

            <template v-if="manuscriptReadings(hovered.run).length > 0">
                <hr class="my-1 border-stone-200 dark:border-stone-800" />
                <p
                    class="text-xs tracking-wide text-stone-400 uppercase dark:text-stone-500"
                >
                    as written
                </p>
                <p
                    v-for="group in manuscriptReadings(hovered.run)"
                    :key="`d-${group.text}`"
                    class="flex gap-2 text-stone-500 dark:text-stone-400"
                >
                    <span>{{ group.text }}</span>
                    <span>{{ group.sigla.join(' ') }}</span>
                </p>
            </template>
        </div>
    </div>
</template>
