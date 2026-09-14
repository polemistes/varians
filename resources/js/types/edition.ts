/**
 * The edition page's server payload — see EditionController::show and
 * segmentDetail() for what each field carries and why.
 */

import type { ConjectureType } from '@/types/models';

/** One recorded citation of a bibliography item — see BibliographyReference. */
export type Citation = {
    id: number;
    item_id: number;
    label: string;
    /** "cf. Wilamowitz 1927, 45" — as the apparatus prints it. */
    citation: string;
    prenote: string | null;
    postnote: string | null;
};

/** A citation of something not yet recorded, held in a form until it submits. */
export type DraftReference = {
    item_id: number;
    label: string;
    prenote: string;
    postnote: string;
};

/** One entry of the edition's bibliography, formatted for reading. */
export type BibliographyEntry = {
    id: number;
    label: string;
    reference: { text: string; italic: boolean }[];
};

export type SegmentListItem = {
    id: number;
    label: string;
    sort_key: string;
    address: Record<string, string | number>;
    status: 'partial' | 'complete';
    page: number;
};

export type Candidate = {
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
    references: Citation[];
    note: string | null;
    range_end_lemma_id: number | null;
    replaced_text: string | null;
    extent_characters: number | null;
    // Picked, this prints nothing: a witness's omission of these columns
    // (LemmaReading::$omitted) or a deletion conjecture. `text` is empty;
    // the apparatus says "omitted" or "deleted" in words.
    omitted: boolean;
    // The transcription text this reading was collated from has since been
    // edited over — see TranscriptionTextController::applyReadings.
    needs_review: boolean;
    // What this witness's manuscript physically shows here. Null for a
    // conjecture (nobody's manuscript reading), for a witness with no visible
    // diplomatic layer, and where the two layers divide the line into a
    // different number of words. See App\Support\Edition\DiplomaticCounterpart.
    diplomatic: string | null;
};

/**
 * A candidate as it travels — see EditionController::slimRun. Every field
 * whose value would be its default (null, false, an empty list) is left
 * out, `key` is left for the client to make from `reading_id`, and
 * `diplomatic` is left out where it is the text itself (null stays: the
 * manuscript's own spelling unknown). `inflateCandidate` in
 * lib/apparatus.ts restores the full shape; the page never reads this one.
 */
export type WireCandidate = Pick<Candidate, 'label' | 'text' | 'reading_id'> &
    Partial<Omit<Candidate, 'key' | 'label' | 'text' | 'reading_id'>>;

export type Run = {
    lemma_id: number | null;
    base_start: number | null;
    base_end: number | null;
    text: string;
    decided: boolean;
    gap: boolean;
    // Nothing is printed here on purpose — the base lacks the words, or an
    // omission or deletion was adopted — where another witness or a
    // conjecture has text. The edition text marks the place.
    omitted: boolean;
    candidates: Candidate[];
    range_end_lemma_id: number | null;
    extent_characters: number | null;
    // The base manuscript's own wording for this run.
    diplomatic: string | null;
    // Every way the witnesses differ here is a matter of accents, breathings
    // or pointing — see EditionController::orthographicVariation.
    orthographic_variation: boolean;
    // This edition's own colometry: a break printed before this run — see
    // EditionLineBreak.
    break_before: 'line' | 'paragraph' | null;
};

/** A run as it travels — see `WireCandidate` and `inflateRun`. */
export type WireRun = Omit<
    Run,
    | 'candidates'
    | 'range_end_lemma_id'
    | 'extent_characters'
    | 'decided'
    | 'gap'
    | 'omitted'
    | 'break_before'
    | 'diplomatic'
    | 'orthographic_variation'
> &
    Partial<
        Pick<
            Run,
            | 'range_end_lemma_id'
            | 'extent_characters'
            | 'decided'
            | 'gap'
            | 'omitted'
            | 'break_before'
            | 'diplomatic'
            | 'orthographic_variation'
        >
    > & { candidates: WireCandidate[] };

export type UnplacedConjecture = {
    id: number;
    type: ConjectureType;
    supplements_conjecture_id: number | null;
    label: string;
    text: string;
    note: string | null;
    references: Citation[];
};

export type OrderCandidate = {
    source: 'transcription' | 'conjecture' | 'numbering';
    transcription_layer_id: number | null;
    conjecture_id: number | null;
    proposed_by: string | null;
    witness_siglum: string | null;
    sequence: string[];
    matches_current: boolean;
};

// One self-contained block of the numbering order that some source — a
// witness's physical order or a catalogued reordering — rearranges. Members
// are contiguous in numbering order but may sit scattered in the printed
// text; every member segment carries the same block. `anchor` marks the
// first member in printed order (unused since the badge moved onto the
// moved lines' own numbers, but still sent).
export type OrderRange = {
    range_key: string;
    range_start_segment_id: number;
    range_end_segment_id: number;
    range_label: string;
    member_segment_ids: number[];
    current_sequence: string[];
    candidates: OrderCandidate[];
    anchor: boolean;
};

// The editor's own note on a point in this edition — free text, because
// what it carries (accentuation, word division, speaker assignment, why a
// reading was printed) is judgment rather than data. `lemma_id` null means
// the note is about the whole segment. See App\Models\EditionComment.
export type EditionComment = {
    id: number;
    lemma_id: number | null;
    range_end_lemma_id: number | null;
    note: string;
    author: string;
};

// A witness whose text for a segment stands in more than one place — a
// transposition split it below segment granularity. Derived server-side
// from the assignment spans; see EditionController::assignmentDiscontinuities.
export type DiscontinuousWitness = {
    // A witness's siglum — or, for a conjecture that divides a line into
    // pieces (see ConjectureOrderingEntry), its proposer with "(conjecture)":
    // the same report serves both.
    siglum: string;
    conjecture_id: number | null;
    // The edition prints this very arrangement — its ordering follows the
    // source; the notice names it at the top instead of listing it as a
    // variant.
    matches_current: boolean;
    parts: { part: number; after_label: string | null }[];
    // Apparatus-style readings of the split — 'R2: 4 2/2 "πάρεστιν
    // ἐνταυθοῖ γυνή·" has exchanged places with 5 2/2 "κωμῆτις ἥδʼ
    // ἐξέρχεται."' for fragments that changed places, 'B: 1.1 2/2 "fox"
    // stands after 1.2' for a lone displaced one. Empty when the parts are
    // merely separated, not displaced.
    statements: string[];
};

/** Where a paratext is printed — see App\Enums\ParatextKind. */
export type ParatextKind =
    'left_margin' | 'right_margin' | 'inline' | 'speaker';

/**
 * What the edition prints beside or among the words without its being
 * text of the work — see App\Models\EditionParatext. It stands before or
 * after one column; `run_index` is the run covering that column (see
 * EditionController::paratextsOf).
 */
export type Paratext = {
    id: number;
    lemma_id: number;
    placement: 'before' | 'after';
    kind: ParatextKind;
    text: string;
    position: number;
    run_index: number;
};

export type WindowSegment = {
    id: number;
    edition_segment_id: number;
    // The printed predecessor's EditionSegment id, from the whole order —
    // null only at the very start of the edition.
    previous_edition_segment_id: number | null;
    label: string;
    order_range: OrderRange | null;
    // Which piece of the segment this row prints: a whole segment is part
    // 1 of 1 over all its runs; a segment the edition prints in pieces
    // (it adopted a transposition moving part of the line) has one row per
    // part, each printing runs run_start..run_end. `division_stale` means
    // the words no longer match the printed text — part 1 then prints the
    // whole segment and the other parts nothing. See EditionSegment::$part.
    part: number;
    parts: number;
    run_start: number;
    run_end: number;
    division_stale: boolean;
    // This edition's own lineation for the segment boundary — verse renders
    // with every flag set, prose with none; mixtures are free.
    starts_new_line: boolean;
    starts_new_paragraph: boolean;
    discontinuous_witnesses: DiscontinuousWitness[];
    base: { transcription_layer_id: number; witness_siglum: string } | null;
    runs: Run[];
    unplacedConjectures: UnplacedConjecture[];
    comments: EditionComment[];
    // The literature this edition cites on the segment as a whole.
    references: Citation[];
    // The base witness's whole line as the manuscript has it.
    base_diplomatic: string | null;
    paratexts: Paratext[];
};

/** A window segment as it travels: its runs in wire form — see `inflateSegment`. */
export type WireWindowSegment = Omit<WindowSegment, 'runs'> & {
    runs: WireRun[];
};

/** A conjecture this edition follows — see EditionTransposition. */
export type TranspositionAdoption = {
    id: number;
    conjecture_id: number;
};

/** A normalized transcript assigning text to the work — which witness, which segments. */
export type TranscriptionOption = {
    id: number;
    name: string;
    witness: { id: number; siglum: string; label: string | null };
    assignments: { id: number; segment_id: number }[];
};

/**
 * What the server's policies allow the viewer on an edition — see
 * EditionController::abilities(). The page shows and hides by these; it
 * never decides them.
 */
export type EditionAbilities = {
    edit: boolean;
    delete: boolean;
    publish: boolean;
    manage: boolean;
    transfer: boolean;
    copy: boolean;
};

/**
 * Who holds an edition and who else may edit it — see
 * EditionController::access(). Editors and the open offer are only sent to
 * whoever may manage them.
 */
export type EditionAccess = {
    owner: { id: number; name: string } | null;
    editors: { id: number; name: string; email: string }[];
    offer: {
        id: number;
        to: { id: number; name: string; email: string };
    } | null;
};
