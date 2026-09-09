/**
 * The Work page's conjecture list — see WorkController::conjectures().
 */

import type { Citation } from '@/types/edition';
import type { ConjectureType } from '@/types/models';

export type WorkConjecture = {
    id: number;
    type: ConjectureType;
    canonical_passage_id: number;
    passage_label: string;
    text: string | null;
    extent: string | null;
    extent_characters: number | null;
    supplements_conjecture_id: number | null;
    supplements_label: string | null;
    transposition_range_end_canonical_passage_id: number | null;
    range_end_label: string | null;
    move_target_canonical_passage_id: number | null;
    target_label: string | null;
    move_position: 'before' | 'after' | null;
    ordering: { id: number; label: string }[];
    proposed_by: string | null;
    entered_by: string;
    note: string | null;
    references: Citation[];
    placed: boolean;
    adopted_by: string[];
    selected_by: string[];
    deletion_impact: {
        readings: number;
        editionSelections: number;
        adoptions: number;
        supplements: number;
        citations: number;
    };
};

/** A passage of the work as the conjecture form addresses it. */
export type WorkPassage = {
    id: number;
    address: Record<string, string | number>;
    label: string;
    sort_key: string;
};
