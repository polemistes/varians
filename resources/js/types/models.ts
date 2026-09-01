/**
 * Plain counts of what else would be deleted alongside a Work, Witness,
 * Transcription, or ManuscriptImage — mirrors App\Support\DeletionImpact.
 * Only the keys relevant to a given entity are ever non-zero; see
 * resources/js/lib/deletionImpact.ts for how this becomes a warning.
 */
export type DeletionImpact = {
    canonicalPassages?: number;
    editions?: number;
    conjectures?: number;
    lemmas?: number;
    transcriptions?: number;
    segments?: number;
    regions?: number;
    images?: number;
    pages?: number;
    editionSelections?: number;
    editionPassages?: number;
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

export type CanonicalPassage = {
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
    canonical_passages?: CanonicalPassage[];
    witnesses?: Witness[];
    editions?: Edition[];
    deletion_impact?: DeletionImpact;
};

export type WitnessType =
    'manuscript' | 'apparatus_reconstruction' | 'printed_edition';

export type Witness = {
    id: number;
    type: WitnessType;
    siglum: string;
    label: string | null;
    manuscript?: Manuscript | null;
    works?: Work[];
    transcriptions?: Transcription[];
    transcription_layers?: TranscriptionLayer[];
    deletion_impact?: DeletionImpact;
};

export type Manuscript = {
    id: number;
    witness_id: number;
    repository: string | null;
    shelfmark: string | null;
    date_text: string | null;
    notes: string | null;
    images?: ManuscriptImage[];
    pages?: ManuscriptPage[];
};

/**
 * One page of a manuscript, named by `label`. A page exists whether or not
 * anyone has photographed it: a transcription is often made from a printed
 * facsimile or the manuscript itself, and its text still has to be divided
 * onto pages.
 */
export type ManuscriptPage = {
    id: number;
    manuscript_id: number;
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
    manuscript_id: number;
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
 * One of a Work's critical texts, built up passage by passage by selecting,
 * for each shared Lemma it has an opinion on, which candidate reading to
 * print — unlike Witness/Transcription, this is a genuine direct relation,
 * not something inferable from citation data.
 */
export type Edition = {
    id: number;
    work_id: number;
    user_id: number;
    title: string;
    description: string | null;
    visibility: Visibility;
    work?: Work;
    user?: { id: number; name: string };
};

/**
 * A slot within one CanonicalPassage, shared by every Edition of the work —
 * most passages get exactly one lemma spanning the whole thing; a passage
 * only gets split into several when readings need to be mixed within it.
 * Which candidate a given Edition prints is recorded separately (see
 * EditionLemma) — collation is edition-independent, selection is not.
 */
export type Lemma = {
    id: number;
    canonical_passage_id: number;
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
    'substitution' | 'lacuna' | 'supplement' | 'transposition';

/**
 * A recorded conjecture for a passage — usually not the current editor's own
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
 *   `canonical_passage_id` (through `transposition_range_end_canonical_passage_id`,
 *   inclusive, if moving more than one passage) is proposed to move
 *   `move_position` ('before'/'after') `move_target_canonical_passage_id`.
 *   `text` is never set.
 *
 * All four still need the same credit — `proposed_by`/`bibliography`.
 */
export type Conjecture = {
    id: number;
    canonical_passage_id: number;
    user_id: number;
    type: ConjectureType;
    text: string | null;
    extent: string | null;
    supplements_conjecture_id: number | null;
    transposition_range_end_canonical_passage_id: number | null;
    move_target_canonical_passage_id: number | null;
    move_position: 'before' | 'after' | null;
    proposed_by: string | null;
    bibliography: string | null;
    note: string | null;
};

/**
 * A canonical passage's membership in an edition — a passage is "in" an
 * edition iff it has a row here. `transcription_layer_id` is the transcription its
 * segment was added from (null only for a whole-line lacuna, which has no
 * manuscript witness at all) and doubles as which transcription's own
 * wording is the display default for this passage. `position` is the order
 * the editor built the edition in — the manuscript's own physical order for
 * a bulk "base a range" add, never citation order.
 */
export type EditionPassage = {
    id: number;
    edition_id: number;
    canonical_passage_id: number;
    transcription_layer_id: number | null;
    position: string;
};

export type Visibility = 'published' | 'draft';

export type Tag = {
    id: number;
    name: string;
};

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
    segments?: TranscriptionSegment[];
    regions?: TranscriptionRegion[];
    tags?: Tag[];
    deletion_impact?: DeletionImpact;
};

/**
 * A citation-span annotation over its parent Transcription's `text` —
 * doesn't own any text of its own. start_offset/end_offset index into
 * Transcription.text. Always cites a canonical passage — a span with no
 * citation has no use to anyone, so one is never created without the other.
 */
export type TranscriptionSegment = {
    id: number;
    transcription_layer_id: number;
    canonical_passage_id: number;
    start_offset: number;
    end_offset: number;
    needs_review: boolean;
    canonical_passage?: CanonicalPassage & { work?: Work };
};

/**
 * An image-alignment span, independent of citation spans — also indexes
 * into the parent Transcription's `text` directly.
 */
export type TranscriptionRegion = {
    id: number;
    transcription_layer_id: number;
    manuscript_image_id: number;
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
