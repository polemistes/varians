/**
 * The edition page's server payload — see EditionController::show and
 * passageDetail() for what each field carries and why.
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

export type PassageListItem = {
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
    source: 'transcription' | 'conjecture' | 'citation';
    transcription_layer_id: number | null;
    conjecture_id: number | null;
    proposed_by: string | null;
    witness_siglum: string | null;
    sequence: string[];
    matches_current: boolean;
};

// One self-contained block of the citation order that some source — a
// witness's physical order or a catalogued reordering — rearranges. Members
// are contiguous in citation order but may sit scattered in the printed
// text; every member passage carries the same block. `anchor` marks the
// first member in printed order (unused since the badge moved onto the
// moved lines' own numbers, but still sent).
export type OrderRange = {
    range_key: string;
    range_start_canonical_passage_id: number;
    range_end_canonical_passage_id: number;
    range_label: string;
    member_canonical_passage_ids: number[];
    current_sequence: string[];
    candidates: OrderCandidate[];
    anchor: boolean;
};

// The editor's own note on a point in this edition — free text, because
// what it carries (accentuation, word division, speaker assignment, why a
// reading was printed) is judgment rather than data. `lemma_id` null means
// the note is about the whole passage. See App\Models\EditionComment.
export type EditionComment = {
    id: number;
    lemma_id: number | null;
    range_end_lemma_id: number | null;
    note: string;
    author: string;
};

// A witness whose text for a passage stands in more than one place — a
// transposition split it below passage granularity. Derived server-side
// from the citation spans; see EditionController::citationDiscontinuities.
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

export type WindowPassage = {
    id: number;
    edition_passage_id: number;
    // The printed predecessor's EditionPassage id, from the whole order —
    // null only at the very start of the edition.
    previous_edition_passage_id: number | null;
    label: string;
    order_range: OrderRange | null;
    // Which piece of the passage this row prints: a whole passage is part
    // 1 of 1 over all its runs; a passage the edition prints in pieces
    // (it adopted a transposition moving part of the line) has one row per
    // part, each printing runs run_start..run_end. `division_stale` means
    // the words no longer match the printed text — part 1 then prints the
    // whole passage and the other parts nothing. See EditionPassage::$part.
    part: number;
    parts: number;
    run_start: number;
    run_end: number;
    division_stale: boolean;
    // This edition's own lineation for the passage boundary — verse renders
    // with every flag set, prose with none; mixtures are free.
    starts_new_line: boolean;
    starts_new_paragraph: boolean;
    discontinuous_witnesses: DiscontinuousWitness[];
    base: { transcription_layer_id: number; witness_siglum: string } | null;
    runs: Run[];
    unplacedConjectures: UnplacedConjecture[];
    comments: EditionComment[];
    // The literature this edition cites on the passage as a whole.
    references: Citation[];
    // The base witness's whole line as the manuscript has it.
    base_diplomatic: string | null;
};

/** A conjecture this edition follows — see EditionTransposition. */
export type TranspositionAdoption = {
    id: number;
    conjecture_id: number;
};

/** A normalized transcript citing the work — which witness, which passages. */
export type TranscriptionOption = {
    id: number;
    name: string;
    witness: { id: number; siglum: string; label: string | null };
    segments: { id: number; canonical_passage_id: number }[];
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
