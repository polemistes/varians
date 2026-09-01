<script setup lang="ts">
import { Head, router, useForm, usePage } from '@inertiajs/vue3';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import AddToEditionPanel from '@/components/AddToEditionPanel.vue';
import AppHeader from '@/components/AppHeader.vue';
import HierarchicalPassagePicker from '@/components/HierarchicalPassagePicker.vue';
import ReorderingAuthorPanel from '@/components/ReorderingAuthorPanel.vue';
import WitnessTranscriptPanel from '@/components/WitnessTranscriptPanel.vue';
import type { WitnessTranscript } from '@/components/WitnessTranscriptPanel.vue';
import { isEditorOrAbove } from '@/lib/auth';
import {
    destroy as destroyComment,
    store as storeComment,
    update as updateComment,
} from '@/routes/edition-comments';
import { destroy as destroyEditionLemma } from '@/routes/edition-lemmas';
import {
    store as storeEditionPassageOrder,
    destroy as destroyEditionPassageOrder,
} from '@/routes/edition-passage-orders';
import { destroy as destroyEditionPassage } from '@/routes/edition-passages';
import {
    store as storeTransposition,
    destroy as destroyTransposition,
} from '@/routes/edition-transpositions';
import { store as storeVariant } from '@/routes/edition-variants';
import {
    destroy as destroyEdition,
    show as showEdition,
    update as updateEdition,
} from '@/routes/editions';
import type { Auth } from '@/types/auth';
import type {
    ConjectureType,
    Edition,
    ReferenceLevel,
    TranscriptionSegment,
    Visibility,
    Work,
} from '@/types/models';

type PassageListItem = {
    id: number;
    label: string;
    sort_key: string;
    address: Record<string, string | number>;
    status: 'partial' | 'complete';
    page: number;
};

type Candidate = {
    key: string;
    label: string;
    text: string;
    selected: boolean;
    reading_id: number | null;
    transcription_layer_id: number | null;
    start_offset: number | null;
    end_offset: number | null;
    conjecture_id: number | null;
    conjecture_type: ConjectureType | null;
    supplements_conjecture_id: number | null;
    bibliography: string | null;
    note: string | null;
    range_end_lemma_id: number | null;
    replaced_text: string | null;
    extent_characters: number | null;
    // The transcription text this reading was collated from has since been
    // edited over — see TranscriptionTextController::applyReadings.
    needs_review: boolean;
    // What this witness's manuscript physically shows here. Null for a
    // conjecture (nobody's manuscript reading), for a witness with no visible
    // diplomatic layer, and where the two layers divide the line into a
    // different number of words. See App\Support\Edition\DiplomaticCounterpart.
    diplomatic: string | null;
};

type Run = {
    lemma_id: number | null;
    base_start: number | null;
    base_end: number | null;
    text: string;
    decided: boolean;
    gap: boolean;
    candidates: Candidate[];
    range_end_lemma_id: number | null;
    extent_characters: number | null;
    // The base manuscript's own wording for this run.
    diplomatic: string | null;
    // Every way the witnesses differ here is a matter of accents, breathings
    // or pointing — see EditionController::orthographicVariation.
    orthographic_variation: boolean;
};

type UnplacedConjecture = {
    id: number;
    type: ConjectureType;
    supplements_conjecture_id: number | null;
    label: string;
    text: string;
    note: string | null;
    bibliography: string | null;
};

type OrderCandidate = {
    source: 'transcription' | 'conjecture';
    transcription_layer_id: number | null;
    conjecture_id: number | null;
    proposed_by: string | null;
    witness_siglum: string | null;
    sequence: string[];
    matches_current: boolean;
};

type OrderRange = {
    range_key: string;
    range_start_canonical_passage_id: number;
    range_end_canonical_passage_id: number;
    edition_passage_order_id: number | null;
    candidates: OrderCandidate[];
};

// The editor's own note on a point in this edition — free text, because
// what it carries (accentuation, word division, speaker assignment, why a
// reading was printed) is judgment rather than data. `lemma_id` null means
// the note is about the whole passage. See App\Models\EditionComment.
type EditionComment = {
    id: number;
    lemma_id: number | null;
    range_end_lemma_id: number | null;
    note: string;
    author: string;
};

type WindowPassage = {
    id: number;
    edition_passage_id: number;
    label: string;
    order_range: OrderRange | null;
    base: { transcription_layer_id: number; witness_siglum: string } | null;
    runs: Run[];
    unplacedConjectures: UnplacedConjecture[];
    comments: EditionComment[];
    // The base witness's whole line as the manuscript has it.
    base_diplomatic: string | null;
};

type TranspositionAdoption = {
    id: number;
    from_label: string;
    to_label: string | null;
    target_label: string;
    move_position: 'before' | 'after';
    proposed_by: string;
};

type TranscriptionOption = {
    id: number;
    witness?: { id: number; siglum: string };
    text: string;
    segments: TranscriptionSegment[];
};

const props = defineProps<{
    work: Pick<Work, 'id' | 'title' | 'slug'>;
    edition: Edition;
    page: number;
    totalPages: number;
    passages: PassageListItem[];
    windowPassages: WindowPassage[];
    transpositions: TranspositionAdoption[];
    transcriptions: TranscriptionOption[];
    workPassages: { id: number; address: Record<string, string | number> }[];
    referenceLevels: ReferenceLevel[];
    witnessTranscripts: WitnessTranscript[];
}>();

// Every canonical passage already in this edition, from any transcription —
// used by the add-to-edition panel to grey out what's already claimed.
const alreadyAddedPassageIds = computed(() =>
    props.passages.map((passage) => passage.id),
);

const inertiaPage = usePage<{ auth: Auth }>();
const mayEdit = computed(() => isEditorOrAbove(inertiaPage.props.auth.user));

// An editor can stand where a reader stands. Everything that edits is gated
// on `canEdit`, so switching this off gives the reader's own view — no
// panels, no markers, notes in the tooltip rather than under the line —
// without needing a second account to check the work in.
const readerView = ref(false);
const canEdit = computed(() => mayEdit.value && !readerView.value);

function goToPage(targetPage: number) {
    router.visit(
        showEdition.url([props.work, props.edition], {
            query: { page: targetPage },
        }),
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

function removeEdition() {
    router.delete(destroyEdition.url(props.edition));
}

// ---- transpositions: an edition's own passage order can float free of
// citation order, exactly like a transcription's physical order already
// does — adopting one moves a range of passages to sit before/after
// another, each still showing its own citation label where it lands. ----
const showTranspositionForm = ref(false);
const transpositionForm = useForm({
    canonical_passage_id: null as number | null,
    transposition_range_end_canonical_passage_id: null as number | null,
    move_target_canonical_passage_id: null as number | null,
    move_position: 'before' as 'before' | 'after',
    proposed_by: '',
    bibliography: '',
    note: '',
});

function submitTransposition() {
    transpositionForm.post(storeTransposition.url(props.edition), {
        preserveScroll: true,
        onSuccess: () => {
            transpositionForm.reset();
            showTranspositionForm.value = false;
        },
    });
}

function removeTransposition(id: number) {
    router.delete(destroyTransposition.url(id), { preserveScroll: true });
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
    | { passageId: number; kind: 'remove' }
    | { passageId: number; kind: 'order_range' };

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

// The one way to dismiss whichever popover (Add Conjecture, Select Variant,
// or Insert Lacuna) is currently open, regardless of how it got opened —
// a click on its own trigger already toggles it closed, but a selection-
// triggered Add Conjecture has no such trigger to click again.
function closePopover() {
    openTarget.value = null;
    submitError.value = null;
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

// ---- the right pane ----
// The page is always two panes: the edition on the left, and on the right one
// of these. Add/remove text also changes what a selection on the *left* means
// — normally the start of authoring a conjecture, it instead offers to remove
// the selected passage (see onDocumentMouseUp).
type RightPane = 'add' | 'witness' | 'images';

// An edition with no text yet opens on the panel that can give it some;
// everyone else opens on the manuscripts, which is what the pane replaced.
const rightPane = ref<RightPane>(
    mayEdit.value &&
        props.windowPassages.length === 0 &&
        props.transcriptions.length > 0
        ? 'add'
        : 'witness',
);

// What actually renders. Mirrors the `canEdit && lacunaMode` test at the
// lacuna markers: the choice records what was asked for, `canEdit` decides
// whether it takes effect. Without this an editor who picked "add / remove
// text" and then switched to reader view kept an editing panel open on a page
// that had just hidden every other way of closing it.
const activeRightPane = computed<RightPane>(() =>
    rightPane.value === 'add' && !canEdit.value ? 'witness' : rightPane.value,
);

const addingText = computed(() => activeRightPane.value === 'add');

const rightPaneChoices = computed<
    { value: RightPane; label: string; disabled?: boolean; note?: string }[]
>(() => [
    ...(canEdit.value
        ? [{ value: 'add' as const, label: 'Add / remove text' }]
        : []),
    { value: 'witness' as const, label: 'The manuscripts' },
    {
        value: 'images' as const,
        label: 'Manuscript images',
        disabled: true,
        note: 'Not yet — witness image handling is still being built.',
    },
]);

// Authoring a brand-new reordering conjecture — a separate concern from
// picking among *existing* candidates (see chooseOrder) — gets its own
// panel, opened either from the toolbar or from an order-range popover's
// "Propose a new reordering…" button (see ReorderingAuthorPanel.vue).
const showReorderingAuthor = ref(false);

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

function isOrderRangeOpen(passageId: number): boolean {
    return (
        openTarget.value?.passageId === passageId &&
        openTarget.value?.kind === 'order_range'
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
    proposed_by: '',
    bibliography: '',
    note: '',
});

const lacunaDraft = reactive({
    label: '',
    extent: '',
    extent_characters: '' as number | '',
    proposed_by: '',
    bibliography: '',
    note: '',
});

function resetLacunaDraft() {
    lacunaDraft.label = '';
    lacunaDraft.extent = '';
    lacunaDraft.extent_characters = '';
    lacunaDraft.proposed_by = '';
    lacunaDraft.bibliography = '';
    lacunaDraft.note = '';
}

function resetConjectureDraft() {
    conjectureDraft.text = '';
    conjectureDraft.proposed_by = '';
    conjectureDraft.bibliography = '';
    conjectureDraft.note = '';
}

// The anchor whose own pending (unselected) candidate reaches at least this
// far, if any — the interior runs a not-yet-adopted range candidate would
// swallow (still independently rendered, since nothing's decided) carry no
// candidate of their own that says so. Used both to flag the whole disputed
// span as "needs a decision" (see runClasses) and to redirect a click
// anywhere in that span to the anchor's own candidate list.
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

function toggleRun(passageId: number, runIndex: number) {
    if (!canEdit.value) {
        return;
    }

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
    // note is written from this panel.
    const anchorIndex = coveringAnchorIndex(passage, runIndex) ?? runIndex;

    if (isRunOpen(passageId, anchorIndex)) {
        openTarget.value = null;

        return;
    }

    openTarget.value = { passageId, kind: 'run', index: anchorIndex };
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

function toggleOrderRange(passageId: number) {
    if (!canEdit.value) {
        return;
    }

    if (isOrderRangeOpen(passageId)) {
        openTarget.value = null;

        return;
    }

    openTarget.value = { passageId, kind: 'order_range' };
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

// The preceding passage's own EditionPassage id, on the current page — null
// both for "the very start of the edition" and, as a rare edge case, for
// the first passage on page 2+ (whose true predecessor sits on the previous
// page, not loaded here); either way the marker still works, it just
// anchors to the start of the edition instead of exactly before that
// passage in that one edge case.
function previousEditionPassageId(passageIndex: number): number | null {
    return props.windowPassages[passageIndex - 1]?.edition_passage_id ?? null;
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
    if (!canEdit.value) {
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

    if (touched.some((t) => t.passageId !== passageId)) {
        return;
    }

    const passage = props.windowPassages.find((p) => p.id === passageId);

    if (!passage) {
        return;
    }

    // The app's own sky highlight (see runClasses/isRunInPendingRange) takes
    // over from here — the native selection has done its job.
    selection.removeAllRanges();

    // While add/remove mode is on, a selection means "remove this passage" —
    // exactly which words were touched doesn't matter, removal is always
    // whole-passage.
    if (addingText.value) {
        openTarget.value = { passageId, kind: 'remove' };
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

// The one way to author a brand new substitution conjecture — a selection
// touching only one run is just a range of one. Only catalogues it as a
// candidate (see EditionVariantController::isNewSubstitution) — it doesn't
// adopt it; adopting is picking it from its anchor's candidate list, same
// as picking anything else already sitting there.
function submitConjecture(
    passage: WindowPassage,
    startIndex: number,
    endIndex: number,
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
        conjecture_type: 'substitution',
        conjecture_text: conjectureDraft.text,
        conjecture_proposed_by: conjectureDraft.proposed_by || null,
        conjecture_bibliography: conjectureDraft.bibliography || null,
        conjecture_note: conjectureDraft.note || null,
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

    return passage.unplacedConjectures.filter((c) => c.type === 'substitution');
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
        conjecture_bibliography: conjectureDraft.bibliography || null,
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
        conjecture_bibliography: lacunaDraft.bibliography || null,
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
            conjecture_bibliography: lacunaDraft.bibliography || null,
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
function removeEditionPassage(editionPassageId: number) {
    router.delete(destroyEditionPassage.url(editionPassageId), {
        preserveScroll: true,
        onSuccess: () => {
            if (openTarget.value?.kind === 'remove') {
                openTarget.value = null;
            }
        },
    });
}

// Choosing which source's own sequence to follow for a range is never a
// transposition conjecture when the source is a manuscript — the
// manuscript itself is the source, not a scholar's proposal, exactly like
// picking a witness's reading for a word-level variant needs no
// attribution either. Picking an already-catalogued reordering conjecture
// goes through the exact same endpoint — it's still just a selection among
// existing candidates, never a new authoring step (see
// ReorderingAuthorPanel for that). Posts directly to
// edition-passage-orders.store, never edition-transpositions.store.
function chooseOrder(range: OrderRange, candidate: OrderCandidate) {
    submitError.value = null;

    router.post(
        storeEditionPassageOrder.url(props.edition),
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
                    Object.values(errors)[0] ?? 'Could not follow that order.';
            },
        },
    );
}

// Reverts to whatever order the edition's passages and any adopted
// transpositions naturally produce — the range becomes eligible to be
// flagged again on the next load.
function removeEditionPassageOrder(editionPassageOrderId: number) {
    router.delete(destroyEditionPassageOrder.url(editionPassageOrderId), {
        preserveScroll: true,
        onSuccess: () => {
            if (openTarget.value?.kind === 'order_range') {
                openTarget.value = null;
            }
        },
    });
}

// Insertion points render between every pair of adjacent runs (and at
// either end) so a lacuna can be dropped in anywhere — but only once the
// passage actually has word-level structure to sit between; a whole-passage
// gap placeholder has none.
function showsBoundaries(passage: WindowPassage): boolean {
    return (
        canEdit.value &&
        lacunaMode.value &&
        passage.runs.length > 0 &&
        !passage.runs.some((run) => run.gap)
    );
}

// Highlighting reflects actual textual disagreement, not just candidate
// count — several witnesses can independently attest the very same reading
// at a column (or a work can have more than one transcription of the same
// witness), and that shouldn't read as "needs a decision."
function hasVariation(run: Run): boolean {
    return new Set(run.candidates.map((candidate) => candidate.text)).size > 1;
}

// A range-shaped candidate's own text is just its proposed replacement —
// nothing there says how many (or which) words it would consume if picked.
// Prefixing the original span it replaces disambiguates that at a glance;
// a plain single-word candidate needs no such prefix, since the run it's
// already offered on is its whole scope.
function candidateSummary(candidate: Candidate): string {
    return candidate.replaced_text !== null
        ? `${candidate.replaced_text} → ${candidate.text}`
        : candidate.text;
}

/**
 * What the tradition has at one word, for the reader's tooltip.
 *
 * Readings are grouped by wording rather than listed per witness, the way an
 * apparatus entry names a reading once and then its sigla — three manuscripts
 * agreeing is one line, not three. The manuscripts' own spellings are grouped
 * the same way, and collapse to a single line whenever they agree, which is
 * the common case.
 */
type ReadingGroup = { text: string; sigla: string[]; printed: boolean };

function groupBy(
    candidates: Candidate[],
    textOf: (candidate: Candidate) => string | null,
    printedText: string,
): ReadingGroup[] {
    const groups = new Map<string, string[]>();

    for (const candidate of candidates) {
        const text = textOf(candidate);

        if (text === null || candidate.transcription_layer_id === null) {
            continue;
        }

        groups.set(text, [...(groups.get(text) ?? []), candidate.label]);
    }

    return [...groups.entries()].map(([text, sigla]) => ({
        text,
        sigla: [...new Set(sigla)].sort(),
        printed: text === printedText,
    }));
}

/**
 * Readings are grouped by what they say, so the key has to be normalized:
 * text pasted or imported is stored in whatever Unicode form it arrived in,
 * and NFC "ἄειδε" and NFD "ἄειδε" are the same word rendered identically but
 * different strings. Ungrouped, one manuscript would be listed twice over a
 * difference nobody can see. Collation already compares in this form — see
 * PassageAligner::comparisonForm.
 */
function sameReading(text: string | null): string | null {
    return text === null ? null : text.normalize('NFC');
}

function witnessReadings(run: Run): ReadingGroup[] {
    return groupBy(run.candidates, (c) => sameReading(c.text), run.text);
}

function manuscriptReadings(run: Run): ReadingGroup[] {
    return groupBy(run.candidates, (c) => sameReading(c.diplomatic), '\u0000');
}

/**
 * What the manuscripts themselves say about a difference, where they can be
 * consulted: 'agree' when every known diplomatic reading is the same,
 * 'differ' when they are not, and 'none' when fewer than two witnesses have a
 * visible diplomatic layer and the question cannot be put to them.
 */
function manuscriptEvidence(run: Run): 'agree' | 'differ' | 'none' {
    const known = run.candidates.filter(
        (candidate) =>
            candidate.transcription_layer_id !== null &&
            candidate.diplomatic !== null,
    );

    if (known.length < 2) {
        return 'none';
    }

    return new Set(known.map((candidate) => candidate.diplomatic)).size === 1
        ? 'agree'
        : 'differ';
}

/**
 * Where a difference came from, in the reader's terms, or null when there is
 * nothing to say.
 *
 * The manuscripts settle it wherever they can be consulted. Where they cannot,
 * a difference of accent, breathing or pointing is still not attributable to
 * them: collation reads the normalized layer, and those marks are supplied in
 * normalizing, so such a difference belongs to the editor until a diplomatic
 * layer shows otherwise.
 */
function differenceProvenance(run: Run): string | null {
    const evidence = manuscriptEvidence(run);

    if (evidence === 'agree') {
        return 'The manuscripts agree here — this difference was made in normalizing, not by the scribes.';
    }

    if (evidence === 'differ' && run.orthographic_variation) {
        return 'The manuscripts themselves differ in accent or pointing here.';
    }

    if (evidence === 'none' && run.orthographic_variation) {
        return 'Accents, breathings and pointing are supplied in normalizing. With no diplomatic layer to check against, this difference cannot be traced to the manuscripts.';
    }

    return null;
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

/** Whether the editor has written about the line as a whole. */
function hasPassageNote(passage: WindowPassage): boolean {
    return passage.comments.some((comment) => comment.lemma_id === null);
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

function conjectureCandidates(run: Run): Candidate[] {
    return run.candidates.filter(
        (candidate) => candidate.conjecture_id !== null,
    );
}

// One floating panel, positioned on hover, rather than a hidden one beside
// every word — a full page of text is several hundred words.
const hovered = ref<{
    passage: WindowPassage;
    run: Run;
    left: number;
    top: number;
} | null>(null);

function showReadings(
    event: MouseEvent,
    passage: WindowPassage,
    runIndex: number,
) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // The site's own run, so hovering any word of a transposition reports the
    // whole competing phrase rather than the one word under the cursor.
    const run = passage.runs[siteAnchorIndex(passage, runIndex)];

    hovered.value = { passage, run, left: rect.left, top: rect.bottom + 4 };
}

function hideReadings() {
    hovered.value = null;
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

// Three states, extending the same amber/emerald vocabulary runClasses()
// already uses for word-level variants: amber for an open, unsettled
// range; emerald once settled by a transcription (a manuscript's own
// order); sky once settled by a conjecture (an editorial invention) — a
// third color specifically for "this order is someone's proposal, not a
// manuscript's own reading."
function orderRangeClasses(range: OrderRange): string[] {
    if (range.edition_passage_order_id === null) {
        return [
            'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900',
        ];
    }

    const settled = range.candidates.find((c) => c.matches_current);

    if (settled?.source === 'conjecture') {
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

            <div
                class="mt-2 mb-1 flex flex-wrap items-baseline justify-between gap-4"
            >
                <h1 class="font-serif text-2xl font-medium">
                    {{ props.edition.title }}
                </h1>
                <div class="flex items-center gap-2 text-xs">
                    <select
                        v-if="canEdit"
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
                class="mb-1 text-sm text-stone-600 dark:text-stone-400"
            >
                {{ props.edition.description }}
            </p>

            <div
                v-if="canEdit"
                class="mb-4 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400"
            >
                <button
                    type="button"
                    class="underline"
                    @click="editingHeader = !editingHeader"
                >
                    {{ editingHeader ? 'Cancel' : 'Edit title/description' }}
                </button>
                <button
                    type="button"
                    class="text-red-600 underline dark:text-red-400"
                    @click="removeEdition"
                >
                    Delete edition
                </button>
            </div>

            <form
                v-if="editingHeader"
                class="mb-6 flex flex-col gap-2 rounded-lg border border-dashed border-stone-300 p-3 text-sm dark:border-stone-700"
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

            <!-- Transpositions -->
            <section
                v-if="canEdit"
                class="mb-6 rounded-lg border border-stone-200 p-3 text-xs dark:border-stone-800"
            >
                <div class="mb-2 flex items-center justify-between">
                    <h3
                        class="font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
                    >
                        Transpositions
                    </h3>
                    <button
                        type="button"
                        class="text-stone-600 underline dark:text-stone-400"
                        @click="showTranspositionForm = !showTranspositionForm"
                    >
                        {{
                            showTranspositionForm
                                ? 'Cancel'
                                : '+ Add transposition'
                        }}
                    </button>
                </div>
                <p class="mb-2 text-stone-500 dark:text-stone-400">
                    This edition's own passage order can differ from citation
                    order, the same way a manuscript's physical order already
                    can — select a passage (or a range) and say it should be
                    read moved before or after another one. Each passage keeps
                    its own citation label wherever it lands.
                </p>
                <ul class="mb-2 flex flex-col gap-1">
                    <li
                        v-for="transposition in props.transpositions"
                        :key="transposition.id"
                        class="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-stone-100 dark:hover:bg-stone-900"
                    >
                        <span
                            >{{ transposition.from_label
                            }}<template v-if="transposition.to_label"
                                >&ndash;{{ transposition.to_label }}</template
                            >
                            moved {{ transposition.move_position }}
                            {{ transposition.target_label }} &mdash;
                            <strong>{{
                                transposition.proposed_by
                            }}</strong></span
                        >
                        <button
                            type="button"
                            class="text-red-600 underline dark:text-red-400"
                            @click="removeTransposition(transposition.id)"
                        >
                            Remove
                        </button>
                    </li>
                    <li
                        v-if="!props.transpositions.length"
                        class="text-stone-500 dark:text-stone-400"
                    >
                        No transpositions adopted yet.
                    </li>
                </ul>
                <form
                    v-if="showTranspositionForm"
                    class="flex flex-wrap items-center gap-2"
                    @submit.prevent="submitTransposition"
                >
                    <span class="text-stone-500 dark:text-stone-400">move</span>
                    <HierarchicalPassagePicker
                        v-model="transpositionForm.canonical_passage_id"
                        :passages="props.passages"
                        :levels="props.referenceLevels"
                    />
                    <span class="text-stone-500 dark:text-stone-400"
                        >through (optional)</span
                    >
                    <HierarchicalPassagePicker
                        v-model="
                            transpositionForm.transposition_range_end_canonical_passage_id
                        "
                        :passages="props.passages"
                        :levels="props.referenceLevels"
                    />
                    <select
                        v-model="transpositionForm.move_position"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    >
                        <option value="before">before</option>
                        <option value="after">after</option>
                    </select>
                    <HierarchicalPassagePicker
                        v-model="
                            transpositionForm.move_target_canonical_passage_id
                        "
                        :passages="props.passages"
                        :levels="props.referenceLevels"
                    />
                    <input
                        v-model="transpositionForm.proposed_by"
                        type="text"
                        placeholder="First proposed by"
                        class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <input
                        v-model="transpositionForm.bibliography"
                        type="text"
                        placeholder="Bibliography"
                        class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <button
                        type="submit"
                        class="rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        :disabled="
                            transpositionForm.processing ||
                            !transpositionForm.canonical_passage_id ||
                            !transpositionForm.move_target_canonical_passage_id
                        "
                    >
                        Add
                    </button>
                    <span
                        v-if="Object.keys(transpositionForm.errors).length"
                        class="block w-full text-red-600 dark:text-red-400"
                    >
                        {{ Object.values(transpositionForm.errors)[0] }}
                    </span>
                </form>
            </section>

            <div
                v-if="mayEdit"
                class="mb-4 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400"
            >
                <button
                    type="button"
                    class="rounded border px-2 py-1"
                    :class="
                        readerView
                            ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                            : 'border-stone-300 dark:border-stone-700'
                    "
                    @click="readerView = !readerView"
                >
                    {{ readerView ? 'Back to editing' : 'Read as a reader' }}
                </button>
            </div>

            <div
                v-if="canEdit"
                class="mb-4 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400"
            >
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
                        showReorderingAuthor
                            ? 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-400'
                            : 'border-stone-300 dark:border-stone-700'
                    "
                    @click="showReorderingAuthor = !showReorderingAuthor"
                >
                    {{
                        showReorderingAuthor
                            ? 'Done proposing'
                            : '+ Propose reordering'
                    }}
                </button>
                <span v-if="lacunaMode">
                    Click a marker between two words to insert a lacuna there.
                </span>
                <span v-if="addingText">
                    Select text on the left to remove that passage — the panel
                    on the right adds new text.
                </span>
            </div>

            <ReorderingAuthorPanel
                v-if="canEdit && showReorderingAuthor"
                :edition="props.edition"
                :passages="props.passages"
                :reference-levels="props.referenceLevels"
            />

            <!-- Always two panes: the edition on the left, and on the right
                 whichever view the reader or editor picked. The manuscripts
                 used to be shown interlinearly, printed under each word of
                 the edition, which read as clutter in the middle of the text
                 rather than as a manuscript. They get their own pane now. -->
            <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <div
                    class="mb-6 rounded-lg border border-stone-200 p-3 text-xs dark:border-stone-800"
                >
                    <h3
                        class="mb-2 font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400"
                    >
                        Edition text
                    </h3>
                    <p class="mb-2 text-stone-500 dark:text-stone-400">
                        The edition's own text, in the order each passage was
                        added.
                    </p>

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

                    <div
                        class="rounded border border-stone-200 p-2 font-serif text-lg leading-loose dark:border-stone-800"
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
                                No transcription cites this work yet. An edition
                                takes its text from cited transcriptions, so
                                there is nothing to add until one exists.
                            </template>
                            <template v-else-if="addingText">
                                This edition has no text yet — add cited
                                passages from the panel on the right.
                            </template>
                            <template v-else-if="canEdit">
                                This edition has no text yet. Choose “Add /
                                remove text” on the right to add passages from
                                the transcriptions that cite this work.
                            </template>
                            <template v-else>
                                This edition has no text yet.
                            </template>
                        </p>

                        <article
                            v-for="(
                                passage, passageIndex
                            ) in props.windowPassages"
                            :id="`passage-${passage.id}`"
                            :key="passage.id"
                        >
                            <span
                                class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide select-none"
                                :class="
                                    hasPassageNote(passage)
                                        ? 'bg-sky-300 text-sky-950 dark:bg-sky-800/60 dark:text-sky-100'
                                        : 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
                                "
                                >{{ passage.label }}</span
                            >

                            <button
                                v-if="passage.order_range"
                                type="button"
                                class="mr-1 rounded px-1.5 py-0.5 align-middle font-sans text-xs tracking-wide select-none"
                                :class="orderRangeClasses(passage.order_range)"
                                :title="
                                    passage.order_range
                                        .edition_passage_order_id !== null
                                        ? 'This line\'s order is a chosen selection — click to review'
                                        : 'Another source has this range in a different order'
                                "
                                @click="toggleOrderRange(passage.id)"
                            >
                                order{{
                                    passage.order_range
                                        .edition_passage_order_id !== null
                                        ? ' ✓'
                                        : '?'
                                }}
                            </button>

                            <button
                                v-if="canEdit && lacunaMode"
                                type="button"
                                class="mr-1 rounded bg-amber-100 px-1 align-middle font-sans text-xs leading-normal text-amber-700 select-none hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                                title="Insert a whole-line lacuna before this passage"
                                @click="
                                    toggleNewPassage(
                                        passage.id,
                                        previousEditionPassageId(passageIndex),
                                    )
                                "
                            >
                                + line
                            </button>

                            <template v-if="passage.base === null">
                                <span
                                    class="font-sans text-sm text-stone-400 italic dark:text-stone-600"
                                    >No base transcription assigned to this
                                    passage yet.</span
                                >
                            </template>
                            <template v-else-if="!passage.runs.length">
                                <span
                                    class="font-sans text-sm text-stone-400 italic dark:text-stone-600"
                                    >Nothing transcribed for this passage
                                    yet.</span
                                >
                            </template>
                            <template v-else>
                                <template
                                    v-for="(run, runIndex) in passage.runs"
                                    :key="runIndex"
                                >
                                    <span
                                        v-if="showsBoundaries(passage)"
                                        class="mx-0.5 cursor-pointer rounded bg-amber-100 px-1 align-middle font-sans text-xs leading-normal text-amber-700 select-none hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                                        title="Insert a lacuna here"
                                        @click="
                                            toggleBoundary(passage.id, runIndex)
                                        "
                                        >+</span
                                    >
                                    <span
                                        class="cursor-pointer"
                                        :data-passage-id="passage.id"
                                        :data-run-index="runIndex"
                                        :class="
                                            runClasses(passage, run, runIndex)
                                        "
                                        @mouseenter="
                                            showReadings(
                                                $event,
                                                passage,
                                                runIndex,
                                            )
                                        "
                                        @mouseleave="hideReadings"
                                        @click="toggleRun(passage.id, runIndex)"
                                        ><template
                                            v-if="
                                                run.extent_characters !== null
                                            "
                                            >&lt;<span
                                                class="inline-block border-b border-dotted border-stone-400 align-middle dark:border-stone-600"
                                                :style="{
                                                    width: `${run.extent_characters}ch`,
                                                }"
                                            ></span
                                            >&gt;</template
                                        ><template v-else>{{
                                            run.text ||
                                            (run.gap ? '⟨gap⟩' : '⟨insert⟩')
                                        }}</template></span
                                    ><span
                                        :class="
                                            spacerClasses(passage, runIndex)
                                        "
                                        >{{ ' ' }}</span
                                    >
                                </template>
                                <span
                                    v-if="showsBoundaries(passage)"
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
                                v-if="canEdit && lacunaMode"
                                type="button"
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
                                    openTarget &&
                                    openTarget.passageId === passage.id
                                "
                                class="my-2 block w-full rounded border p-2 font-sans text-xs whitespace-normal"
                                :class="
                                    openTarget.kind === 'boundary'
                                        ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'
                                        : 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950'
                                "
                            >
                                <div class="mb-2 flex justify-end">
                                    <button
                                        type="button"
                                        class="text-stone-500 underline hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                                        @click="closePopover"
                                    >
                                        Cancel
                                    </button>
                                </div>

                                <!-- Insert lacuna -->
                                <template v-if="openTarget.kind === 'boundary'">
                                    <p
                                        class="mb-1 text-stone-500 dark:text-stone-400"
                                    >
                                        A lacuna doesn't replace any text — it's
                                        inserted here, between the surrounding
                                        words.
                                    </p>
                                    <ul
                                        v-if="
                                            unplacedLacunasFor(passage).length
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
                                        <div class="flex flex-wrap gap-1">
                                            <input
                                                v-model="
                                                    lacunaDraft.proposed_by
                                                "
                                                type="text"
                                                placeholder="First proposed by"
                                                class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                            />
                                            <input
                                                v-model="
                                                    lacunaDraft.bibliography
                                                "
                                                type="text"
                                                placeholder="Bibliography"
                                                class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
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
                                <template v-else-if="openTarget.kind === 'run'">
                                    <template
                                        v-for="run in [
                                            passage.runs[openTarget.index],
                                        ]"
                                        :key="run.lemma_id ?? 'gap'"
                                    >
                                        <p
                                            v-if="run.gap"
                                            class="mb-1 text-stone-500 dark:text-stone-400"
                                        >
                                            No witness covers this whole passage
                                            under the current base &mdash; pick
                                            a starting point:
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
                                                @click="revertRange(run)"
                                            >
                                                Revert to per-word view
                                            </button>
                                        </p>
                                        <ul class="mb-2 flex flex-col gap-1">
                                            <li
                                                v-for="candidate in run.candidates"
                                                :key="candidate.key"
                                                class="flex items-center justify-between gap-2 rounded p-1"
                                                :class="
                                                    candidate.selected
                                                        ? 'bg-emerald-100 dark:bg-emerald-950/50'
                                                        : 'hover:bg-white dark:hover:bg-stone-900'
                                                "
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
                                                                  run,
                                                                  candidate.conjecture_id,
                                                              )
                                                            : pickWitness(
                                                                  passage,
                                                                  run,
                                                                  candidate,
                                                              )
                                                    "
                                                >
                                                    <strong
                                                        >{{
                                                            candidate.label
                                                        }}:</strong
                                                    >
                                                    {{
                                                        candidateSummary(
                                                            candidate,
                                                        )
                                                    }}
                                                    <em
                                                        v-if="
                                                            candidate.diplomatic
                                                        "
                                                        class="text-stone-500 dark:text-stone-400"
                                                        >({{
                                                            candidate.diplomatic
                                                        }})</em
                                                    >
                                                    <span
                                                        v-if="
                                                            candidate.needs_review
                                                        "
                                                        class="rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                                        title="The transcription text this reading was collated from has since been edited — re-confirm it still says what the manuscript says."
                                                        >needs review</span
                                                    >
                                                    <em
                                                        v-if="
                                                            candidate.bibliography
                                                        "
                                                        >({{
                                                            candidate.bibliography
                                                        }})</em
                                                    >
                                                    <em v-if="candidate.note"
                                                        >&mdash;
                                                        {{ candidate.note }}</em
                                                    >
                                                </button>
                                                <span
                                                    v-if="candidate.selected"
                                                    class="text-emerald-700 dark:text-emerald-400"
                                                    >selected</span
                                                >
                                            </li>
                                        </ul>

                                        <template v-if="canEdit && !run.gap">
                                            <ul
                                                v-if="
                                                    unplacedForRun(passage, run)
                                                        .length
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
                                                        {{ conjecture.text }}
                                                    </button>
                                                </li>
                                            </ul>
                                            <div
                                                v-if="lacunaCandidateOf(run)"
                                                class="flex flex-col gap-1"
                                            >
                                                <p
                                                    class="text-stone-500 dark:text-stone-400"
                                                >
                                                    Propose a supplement for
                                                    this lacuna:
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
                                                    <input
                                                        v-model="
                                                            conjectureDraft.bibliography
                                                        "
                                                        type="text"
                                                        placeholder="Bibliography"
                                                        class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
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
                                    v-else-if="openTarget.kind === 'range'"
                                >
                                    <p
                                        class="mb-2 text-stone-500 dark:text-stone-400"
                                    >
                                        Replacing
                                        <strong>{{
                                            rangeSelectionText(
                                                passage,
                                                openTarget,
                                            )
                                        }}</strong>
                                        with:
                                    </p>
                                    <div class="flex flex-col gap-1">
                                        <input
                                            v-model="conjectureDraft.text"
                                            type="text"
                                            placeholder="Proposed text"
                                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                        />
                                        <div class="flex flex-wrap gap-1">
                                            <input
                                                v-model="
                                                    conjectureDraft.proposed_by
                                                "
                                                type="text"
                                                placeholder="First proposed by"
                                                class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                            />
                                            <input
                                                v-model="
                                                    conjectureDraft.bibliography
                                                "
                                                type="text"
                                                placeholder="Bibliography"
                                                class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            class="self-start rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                            :disabled="!conjectureDraft.text"
                                            @click="
                                                submitConjecture(
                                                    passage,
                                                    openTarget.startIndex,
                                                    openTarget.endIndex,
                                                )
                                            "
                                        >
                                            Add conjecture
                                        </button>
                                    </div>
                                </template>

                                <!-- Remove from edition -->
                                <template
                                    v-else-if="openTarget.kind === 'remove'"
                                >
                                    <p
                                        class="mb-2 text-stone-500 dark:text-stone-400"
                                    >
                                        Remove
                                        <strong>{{ passage.label }}</strong>
                                        from this edition? It becomes available
                                        again in every transcription citing it.
                                    </p>
                                    <button
                                        type="button"
                                        class="self-start rounded bg-red-600 px-2 py-1 text-white dark:bg-red-500"
                                        @click="
                                            removeEditionPassage(
                                                passage.edition_passage_id,
                                            )
                                        "
                                    >
                                        Remove from edition
                                    </button>
                                </template>

                                <!-- Order range: exactly like choosing
                                    among witness readings for a word — the
                                    editor picks which source's own order to
                                    follow, whether that's a manuscript's
                                    own reading or a catalogued conjecture. -->
                                <template
                                    v-else-if="
                                        openTarget.kind === 'order_range' &&
                                        passage.order_range
                                    "
                                >
                                    <p
                                        class="mb-2 text-stone-500 dark:text-stone-400"
                                    >
                                        Sources disagree how this range should
                                        read.
                                    </p>
                                    <ul class="mb-2 flex flex-col gap-1">
                                        <li
                                            v-for="candidate in passage
                                                .order_range.candidates"
                                            :key="`${candidate.source}-${candidate.transcription_layer_id ?? candidate.conjecture_id}`"
                                            class="rounded p-1"
                                            :class="
                                                candidate.matches_current
                                                    ? 'bg-emerald-100 dark:bg-emerald-950/50'
                                                    : 'hover:bg-white dark:hover:bg-stone-900'
                                            "
                                        >
                                            <div
                                                class="mb-1 flex items-center justify-between gap-2"
                                            >
                                                <span>
                                                    <strong>{{
                                                        candidate.witness_siglum ??
                                                        candidate.proposed_by ??
                                                        'Anonymous'
                                                    }}</strong>
                                                    <em
                                                        v-if="
                                                            candidate.source ===
                                                            'conjecture'
                                                        "
                                                    >
                                                        (conjecture)</em
                                                    >
                                                    <span
                                                        v-if="
                                                            candidate.matches_current
                                                        "
                                                    >
                                                        — current</span
                                                    >
                                                </span>
                                                <button
                                                    v-if="
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
                                                    Follow
                                                </button>
                                            </div>
                                            <p
                                                class="text-stone-500 dark:text-stone-400"
                                            >
                                                {{
                                                    candidate.sequence.join(
                                                        ', ',
                                                    )
                                                }}
                                            </p>
                                        </li>
                                    </ul>
                                    <div
                                        class="flex flex-wrap items-center gap-3"
                                    >
                                        <button
                                            type="button"
                                            class="text-stone-700 underline dark:text-stone-300"
                                            @click="showReorderingAuthor = true"
                                        >
                                            Propose a new reordering…
                                        </button>
                                        <button
                                            v-if="
                                                passage.order_range
                                                    .edition_passage_order_id !==
                                                null
                                            "
                                            type="button"
                                            class="text-red-600 underline dark:text-red-400"
                                            @click="
                                                removeEditionPassageOrder(
                                                    passage.order_range
                                                        .edition_passage_order_id,
                                                )
                                            "
                                        >
                                            Remove this choice
                                        </button>
                                    </div>
                                </template>

                                <!-- Insert a whole-line lacuna -->
                                <template
                                    v-else-if="
                                        openTarget.kind === 'new_passage'
                                    "
                                >
                                    <p
                                        class="mb-1 text-stone-500 dark:text-stone-400"
                                    >
                                        A whole-line lacuna has no manuscript
                                        witness of its own — name the line it
                                        should occupy (e.g. "80A") and it
                                        becomes its own passage.
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
                                        <div class="flex flex-wrap gap-1">
                                            <input
                                                v-model="
                                                    lacunaDraft.proposed_by
                                                "
                                                type="text"
                                                placeholder="First proposed by"
                                                class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                            />
                                            <input
                                                v-model="
                                                    lacunaDraft.bibliography
                                                "
                                                type="text"
                                                placeholder="Bibliography"
                                                class="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            class="self-start rounded bg-stone-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                            :disabled="!lacunaDraft.label"
                                            @click="submitWholeLineLacuna()"
                                        >
                                            Insert whole-line lacuna
                                        </button>
                                    </div>
                                </template>

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
                                        v-if="notingPassageId !== passage.id"
                                        type="button"
                                        class="mt-2 block text-stone-500 underline dark:text-stone-400"
                                        @click="openNoteComposer(passage)"
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
                                                noteAnchor(passage).lemma_id !==
                                                null
                                                    ? 'Note on the selected words'
                                                    : 'Note on this line'
                                            "
                                            class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                        ></textarea>
                                        <span class="flex items-center gap-2">
                                            <button
                                                type="button"
                                                class="rounded bg-stone-900 px-2 py-0.5 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                                :disabled="!noteDraft.trim()"
                                                @click="saveNote(passage)"
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

                            <!-- The editor's own notes on this line: the
                                 judgments the apparatus can't carry —
                                 accentuation, word division, speaker
                                 assignment, why a reading was printed. -->
                            <div
                                v-if="canEdit && passage.comments.length > 0"
                                class="mt-2 border-l-2 border-stone-200 pl-3 font-sans text-sm dark:border-stone-800"
                            >
                                <p
                                    v-for="comment in passage.comments"
                                    :key="comment.id"
                                    class="mb-1 text-stone-600 dark:text-stone-400"
                                >
                                    <em
                                        v-if="noteAnchorText(passage, comment)"
                                        class="text-stone-800 dark:text-stone-200"
                                        >{{ noteAnchorText(passage, comment) }}]
                                    </em>
                                    <template
                                        v-if="editingNoteId !== comment.id"
                                    >
                                        {{ comment.note }}
                                        <span class="text-stone-400"
                                            >— {{ comment.author }}</span
                                        >
                                        <button
                                            v-if="canEdit"
                                            type="button"
                                            class="ml-2 text-xs underline"
                                            @click="startEditingNote(comment)"
                                        >
                                            edit
                                        </button>
                                        <button
                                            v-if="canEdit"
                                            type="button"
                                            class="ml-1 text-xs text-red-600 underline dark:text-red-400"
                                            @click="removeNote(comment)"
                                        >
                                            delete
                                        </button>
                                    </template>
                                </p>

                                <!-- Rewording an existing note happens where
                                     the note is; writing a new one happens in
                                     the panel over the words it is about. -->
                                <div
                                    v-if="canEdit && editingNoteId !== null"
                                    class="mt-1 flex flex-col gap-1"
                                >
                                    <textarea
                                        v-model="noteDraft"
                                        rows="2"
                                        placeholder="Reword this note"
                                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                                    ></textarea>
                                    <span class="flex items-center gap-2">
                                        <button
                                            type="button"
                                            class="rounded bg-stone-900 px-2 py-0.5 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                                            :disabled="!noteDraft.trim()"
                                            @click="saveNote(passage)"
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
                        </article>
                    </div>
                </div>

                <!-- The right pane. Whichever view is chosen sits next to the
                edition's own continuous text, exactly where the transcription
                editor's own editing interface sits next to its image view. -->
                <div>
                    <div
                        class="mb-2 flex flex-wrap items-center gap-1 text-xs text-stone-500 dark:text-stone-400"
                    >
                        <button
                            v-for="choice in rightPaneChoices"
                            :key="choice.value"
                            type="button"
                            class="rounded border px-2 py-1"
                            :class="[
                                activeRightPane === choice.value
                                    ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                    : 'border-stone-300 dark:border-stone-700',
                                choice.disabled
                                    ? 'cursor-not-allowed opacity-50'
                                    : '',
                            ]"
                            :disabled="choice.disabled"
                            :title="choice.note"
                            @click="rightPane = choice.value"
                        >
                            {{ choice.label }}
                        </button>
                    </div>

                    <AddToEditionPanel
                        v-if="activeRightPane === 'add'"
                        :edition="props.edition"
                        :transcriptions="props.transcriptions"
                        :already-added-passage-ids="alreadyAddedPassageIds"
                        :passages="props.workPassages"
                        :reference-levels="props.referenceLevels"
                    />
                    <WitnessTranscriptPanel
                        v-else-if="activeRightPane === 'witness'"
                        :transcripts="props.witnessTranscripts"
                    />
                </div>
            </div>
        </div>

        <!-- What the tradition has at the word under the cursor. Shown for
             every word, not only the disputed ones: "all three manuscripts
             agree here" is an answer a reader may want too. -->
        <div
            v-if="hovered"
            class="pointer-events-none fixed z-30 max-w-md rounded border border-stone-300 bg-white px-3 py-2 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900"
            :style="{ left: `${hovered.left}px`, top: `${hovered.top}px` }"
        >
            <p
                v-for="group in witnessReadings(hovered.run)"
                :key="`w-${group.text}`"
                class="flex gap-2"
            >
                <span :class="group.printed ? 'font-medium' : ''">{{
                    group.text
                }}</span>
                <span class="text-stone-500 dark:text-stone-400">{{
                    group.sigla.join(' ')
                }}</span>
            </p>

            <p
                v-for="candidate in conjectureCandidates(hovered.run)"
                :key="`c-${candidate.key}`"
                class="flex gap-2 text-sky-800 dark:text-sky-300"
            >
                <span :class="candidate.selected ? 'font-medium' : ''">{{
                    candidate.text
                }}</span>
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
