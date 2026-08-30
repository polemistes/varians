<?php

namespace App\Support\Edition;

use App\Models\Edition;
use App\Models\EditionPassage;
use Illuminate\Validation\Validator;

/**
 * Range-end (if given) must come at or after the range start, and the move
 * target can't sit inside the range being moved — compared via this
 * edition's own EditionPassage.position (the manuscript-derived order this
 * edition was actually built in), never citation sort_key: a transposition
 * is the editor's claim that a passage belongs somewhere other than where
 * the edition's own order currently has it, not somewhere other than its
 * citation number. Declarative `Rule::exists('edition_passages', ...)`
 * rules in StoreEditionTranspositionRequest already ensure every referenced
 * passage is actually in this edition; this only checks the relationship
 * between them, and silently bails (rather than adding a second error) if
 * one isn't found — that's already reported by the declarative rule.
 */
class TranspositionValidator
{
    public static function validate(
        Validator $validator,
        Edition $edition,
        int $rangeStartCanonicalPassageId,
        ?int $rangeEndCanonicalPassageId,
        ?int $targetCanonicalPassageId,
        string $rangeEndField,
        string $targetField,
    ): void {
        $rangeStart = self::editionPassage($edition, $rangeStartCanonicalPassageId);

        if ($rangeStart === null) {
            return;
        }

        $rangeEnd = $rangeStart;

        if ($rangeEndCanonicalPassageId !== null) {
            $rangeEnd = self::editionPassage($edition, $rangeEndCanonicalPassageId);

            if ($rangeEnd === null) {
                return;
            }

            if ((float) $rangeEnd->position < (float) $rangeStart->position) {
                $validator->errors()->add($rangeEndField, 'The range must end at or after where it starts.');

                return;
            }
        }

        if ($targetCanonicalPassageId === null) {
            return;
        }

        $target = self::editionPassage($edition, $targetCanonicalPassageId);

        if ($target === null) {
            return;
        }

        if ((float) $target->position >= (float) $rangeStart->position && (float) $target->position <= (float) $rangeEnd->position) {
            $validator->errors()->add($targetField, 'The target can\'t be inside the range being moved.');
        }
    }

    private static function editionPassage(Edition $edition, int $canonicalPassageId): ?EditionPassage
    {
        return EditionPassage::where('edition_id', $edition->id)
            ->where('canonical_passage_id', $canonicalPassageId)
            ->first();
    }
}
