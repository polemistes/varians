/**
 * Plain counts of what else would be deleted alongside a Work, Witness,
 * Transcription, or ManuscriptImage — mirrors App\Support\DeletionImpact.
 * Only the keys relevant to a given entity are ever non-zero; see
 * resources/js/lib/deletionImpact.ts for how this becomes a warning.
 */
export type DeletionImpact = {
    segments?: number;
    editions?: number;
    conjectures?: number;
    lemmas?: number;
    transcriptions?: number;
    assignments?: number;
    regions?: number;
    images?: number;
    pages?: number;
    editionSelections?: number;
    editionSegments?: number;
    features?: number;
};

export type ReferenceLevel = {
    key: string;
    label: string;
    type: 'integer' | 'string';
    separator?: string;
};

export type ReferenceScheme = {
    id: number;
    name: string;
    levels: ReferenceLevel[];
};

export type Segment = {
    id: number;
    work_id: number;
    address: Record<string, string | number>;
    sort_key: string;
    label: string;
};

export type Work = {
    id: number;
    reference_scheme_id: number;
    title: string;
    author: string | null;
    language: string;
    slug: string;
    reference_scheme?: ReferenceScheme;
    segments?: Segment[];
    witnesses?: Witness[];
    editions?: Edition[];
    deletion_impact?: DeletionImpact;
};

/**
 * A physical or textual source. There is no witness "type": every witness
 * carries the whole physical apparatus (repository, shelfmark, date, pages,
 * photographs), each field optional — a collection of readings from the
 * Suda simply leaves the shelfmark empty.
 */
export type Witness = {
    id: number;
    siglum: string;
    label: string | null;
    repository: string | null;
    shelfmark: string | null;
    date_text: string | null;
    description: string | null;
    works?: Work[];
    transcriptions?: Transcription[];
    transcription_layers?: TranscriptionLayer[];
    images?: ManuscriptImage[];
    pages?: ManuscriptPage[];
    deletion_impact?: DeletionImpact;
};

/**
 * One page of a manuscript, named by `label`. A page exists whether or not
 * anyone has photographed it: a transcription is often made from a printed
 * facsimile or the manuscript itself, and its text still has to be divided
 * onto pages.
 */
export type ManuscriptPage = {
    id: number;
    witness_id: number;
    label: string;
    position: number;
    images?: ManuscriptImage[];
};

/**
 * Where a manuscript page begins in a transcription, as a line number.
 *
 * One division for both layers: a page holds a stretch of the manuscript and
 * both layers transcribe that same stretch. The coordinate is the line because
 * it is the only one they share — their character offsets differ, but a line
 * of the transcription is a line of the manuscript in either.
 *
 * A single number, not a range: the page runs from here to wherever the next
 * begins, so pages cannot overlap or leave gaps.
 */
export type TranscriptionPageBreak = {
    id: number;
    transcription_id: number;
    manuscript_page_id: number;
    start_line: number;
    manuscript_page?: ManuscriptPage;
};

export type ManuscriptImage = {
    id: number;
    witness_id: number;
    manuscript_page_id: number;
    manuscript_page?: ManuscriptPage;
    url: string;
    position: string;
    features?: ManuscriptImageFeature[];
    deletion_impact?: DeletionImpact;
};

export type ManuscriptImageFeature = {
    id: number;
    manuscript_image_id: number;
    label: string;
    x: string;
    y: string;
    width: string;
    height: string;
};

/**
 * One of a Work's critical texts, built up segment by segment by selecting,
 * for each shared Lemma it has an opinion on, which candidate reading to
 * print — unlike Witness/Transcription, this is a genuine direct relation,
 * not something inferable from assignment data.
 */
/** How an edition sets its speaker indications — see App\Enums\SpeakerDisplay. */
export type SpeakerDisplay =
    'inline' | 'line_start_margin' | 'own_line' | 'own_line_centered';

export type Edition = {
    id: number;
    work_id: number;
    user_id: number;
    title: string;
    description: string | null;
    visibility: Visibility;
    speaker_display: SpeakerDisplay;
    work?: Work;
    user?: { id: number; name: string };
};

/**
 * A slot within one Segment, shared by every Edition of the work —
 * most segments get exactly one lemma spanning the whole thing; a segment
 * only gets split into several when readings need to be mixed within it.
 * Which candidate a given Edition prints is recorded separately (see
 * EditionLemma) — collation is edition-independent, selection is not.
 */
export type Lemma = {
    id: number;
    segment_id: number;
    position: string;
};

/**
 * One candidate reading attached to a Lemma — either a span directly into
 * one transcription's continuous text, or a Conjecture. Exactly one of the
 * two is set. Shared by every edition.
 */
export type LemmaReading = {
    id: number;
    lemma_id: number;
    transcription_layer_id: number | null;
    start_offset: number | null;
    end_offset: number | null;
    conjecture_id: number | null;
};

/**
 * Which of a Lemma's candidate readings a given Edition currently prints —
 * a thin per-edition selection, not an owner of readings.
 */
export type EditionLemma = {
    id: number;
    edition_id: number;
    lemma_id: number;
    selected_reading_id: number;
};

export type ConjectureType =
    | 'substitution'
    | 'deletion'
    | 'lacuna'
    | 'supplement'
    | 'transposition'
    | 'reordering';

/**
 * A recorded conjecture for a segment — usually not the current editor's own
 * idea, but one a scholar proposed long ago. `proposed_by` is that
 * historical proposer (free text); `user_id` stays attribution for who
 * entered the record into Varians, not who thought of it.
 *
 * Not every conjecture is a plain substitution — see `ConjectureType`:
 * - Lacuna: a pure insertion, never a competing candidate for an existing
 *   word. `text` is always null; `extent` optionally describes how much is
 *   believed missing. A restoration is a separate Supplement, never its own
 *   text.
 * - Supplement: a proposed restoration for a specific Lacuna
 *   (`supplements_conjecture_id`) — several, from different proposers, can
 *   target the same one. `text` required.
 * - Transposition: an edition-ordering proposal, not a word-level one —
 *   `segment_id` (through `transposition_range_end_segment_id`,
 *   inclusive, if moving more than one segment) is proposed to move
 *   `move_position` ('before'/'after') `move_target_segment_id`.
 *   `text` is never set.
 *
 * All four still need the same credit — `proposed_by`, and assignments.
 */
export type Conjecture = {
    id: number;
    segment_id: number;
    user_id: number;
    type: ConjectureType;
    text: string | null;
    extent: string | null;
    supplements_conjecture_id: number | null;
    transposition_range_end_segment_id: number | null;
    move_target_segment_id: number | null;
    move_position: 'before' | 'after' | null;
    proposed_by: string | null;
    note: string | null;
};

/**
 * A segment's membership in an edition — a segment is "in" an
 * edition iff it has a row here. `transcription_layer_id` is the transcription its
 * assignment was added from (null only for a whole-line lacuna, which has no
 * manuscript witness at all) and doubles as which transcription's own
 * wording is the display default for this segment. `position` is the order
 * the editor built the edition in — the manuscript's own physical order for
 * a bulk "base a range" add, never numbering order.
 */
export type EditionSegment = {
    id: number;
    edition_id: number;
    segment_id: number;
    transcription_layer_id: number | null;
    position: string;
};

export type Visibility = 'published' | 'draft';

/**
 * Which of a transcription's two layers this is. A transcription holds one
 * transcription per layer: `diplomatic` records what the manuscript
 * physically has, `normalized` is the editor's regularization and the layer
 * collation runs on. See App\Enums\Layer.
 */
export type Layer = 'diplomatic' | 'normalized';

/**
 * One transcription of a witness, consisting of exactly two layers. A witness
 * may be transcribed more than once — a manuscript can carry texts belonging
 * to different works, or several kinds of text across the same pages — and
 * nothing records which is the principal one. The editor names them.
 */
export type Transcription = {
    id: number;
    witness_id: number;
    name: string;
    position: number;
    visibility: Visibility;
    // When this transcript was made. A copied witness carries transcripts
    // of the same name, so the date is what tells them apart.
    created_at?: string | null;
    witness?: Witness;
    layers?: TranscriptionLayer[];
};

/**
 * One layer of a transcription. It owns the continuous `text` and everything
 * carrying character offsets into it. Visibility is not here: a transcription
 * is public or it is not, and if it is, both of its layers are.
 */
export type TranscriptionLayer = {
    id: number;
    transcription_id: number;
    user_id: number;
    copied_from_id: number | null;
    layer: Layer;
    text: string;
    transcription?: Transcription;
    witness?: Witness;
    user?: { id: number; name: string };
    assignments?: Assignment[];
    regions?: TranscriptionRegion[];
    deletion_impact?: DeletionImpact;
};

/**
 * An assignment-span annotation over its parent Transcription's `text` —
 * doesn't own any text of its own. start_offset/end_offset index into
 * Transcription.text. Always assigns text to a segment — a span with no
 * assignment has no use to anyone, so one is never created without the other.
 *
 * Several spans in one layer may assign the same segment — its witness text is
 * then physically discontinuous (a transposition split it) — and `part`
 * orders them by content, independently of where each physically sits.
 */
export type Assignment = {
    id: number;
    transcription_layer_id: number;
    segment_id: number;
    start_offset: number;
    end_offset: number;
    part: number;
    needs_review: boolean;
    // Derived after every save: the span begins or ends inside a word
    // (no neighbouring assignment) or overlaps one — see AssignmentIntegrity.
    boundary_review?: boolean;
    segment?: Segment & { work?: Work };
    /** Display ordinal among the segment's LIVE parts (client-derived). */
    part_ordinal?: number;
};

/**
 * An image-alignment span, independent of assignment spans — also indexes
 * into the parent Transcription's `text` directly.
 */
export type TranscriptionRegion = {
    id: number;
    transcription_layer_id: number;
    manuscript_image_id: number;
    // A mapping is one box in both layers — counterpart rows share a
    // group (see SiblingSync); absent on rows made before the pairing.
    group_id?: string | null;
    text: string;
    start_offset: number;
    end_offset: number;
    position: string;
    x: string;
    y: string;
    width: string;
    height: string;
    needs_review: boolean;
};
