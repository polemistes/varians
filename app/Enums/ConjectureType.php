<?php

namespace App\Enums;

/**
 * What kind of editorial proposal a Conjecture records:
 * - Substitution: the transmitted text should read differently here.
 *   `text` required.
 * - Lacuna: text has been lost here — a pure insertion, never a competing
 *   candidate for an existing word. `text` is always null; `extent`
 *   optionally describes how much is believed missing. It never carries its
 *   own restoration — see Supplement.
 * - Supplement: a proposed restoration for a specific Lacuna
 *   (`supplements_conjecture_id`). Several supplements, from different
 *   proposers, can compete for the same lacuna. `text` required.
 * - Transposition: this passage (or, with
 *   `transposition_range_end_canonical_passage_id`, a range of consecutive
 *   passages) is proposed to be read moved `move_position` ('before' /
 *   'after') `move_target_canonical_passage_id` — an edition-ordering
 *   proposal, not a word-level one. `text` is never set; the moved
 *   passage(s) keep printing whatever they already read.
 * - Reordering: a proposed *internal* sequence for a fixed set of passages —
 *   not moved anywhere, just read in a different order among themselves
 *   (see `Conjecture::orderingEntries()`). Competes in the same pool a
 *   transcription's own physical order already forms for that same set of
 *   passages; `canonical_passage_id` is only the set's first passage by
 *   citation order, kept as the usual anchor. `text` is never set.
 */
enum ConjectureType: string
{
    case Substitution = 'substitution';
    case Lacuna = 'lacuna';
    case Supplement = 'supplement';
    case Transposition = 'transposition';
    case Reordering = 'reordering';
}
