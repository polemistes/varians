<?php

namespace App\Support\Edition;

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Adopting a catalogued ordering proposal for an edition: the printed
 * order takes the proposal's sequence, and — what makes a proposal that
 * moves PART of a line printable — each line the proposal divides gets one
 * EditionPassage row per part, while a line it reads whole is rejoined.
 * The pieces are then resequenced in place (PassageOrderRewriter) and the
 * adoption recorded (EditionTransposition). The parts' words are stored
 * with the rows; whether they still match the line's printed text is
 * judged when the page renders (EditionController::partRange), never
 * here — adopting stores what the proposal says.
 *
 * Serves Reorderings (stored pieces) and Transpositions (a statement,
 * projected onto the edition's passages between its anchors).
 */
class ArrangementAdopter
{
    public static function adopt(Edition $edition, Conjecture $conjecture): void
    {
        $pieces = self::pieces($edition, $conjecture);

        if ($pieces === null) {
            throw ValidationException::withMessages([
                'conjecture_id' => 'That proposal no longer fits the lines this edition contains.',
            ]);
        }

        DB::transaction(function () use ($edition, $conjecture, $pieces) {
            self::divideLines($edition, $pieces);

            $sequence = array_map(fn (array $piece) => [
                'canonical_passage_id' => $piece['canonical_passage_id'],
                'part' => $piece['part'],
            ], $pieces);

            if (! PassageOrderRewriter::applyPieceSequence($edition, $sequence)) {
                throw ValidationException::withMessages([
                    'conjecture_id' => 'That proposal names a line this edition does not contain.',
                ]);
            }

            EditionTransposition::firstOrCreate([
                'edition_id' => $edition->id,
                'conjecture_id' => $conjecture->id,
            ]);
        });
    }

    /**
     * The proposal as pieces in proposed order; null when it cannot be
     * projected onto this edition.
     *
     * @return list<array{canonical_passage_id: int, part: int, text: string|null}>|null
     */
    private static function pieces(Edition $edition, Conjecture $conjecture): ?array
    {
        if ($conjecture->type === ConjectureType::Reordering) {
            $pieces = [];

            foreach ($conjecture->orderingEntries()->orderBy('sequence')->get() as $entry) {
                $pieces[] = [
                    'canonical_passage_id' => (int) $entry->canonical_passage_id,
                    'part' => (int) $entry->part,
                    'text' => $entry->text,
                ];
            }

            return $pieces === [] ? null : $pieces;
        }

        if ($conjecture->type !== ConjectureType::Transposition) {
            return null;
        }

        $anchorIds = array_values(array_unique(array_filter([
            $conjecture->canonical_passage_id,
            $conjecture->transposition_range_end_canonical_passage_id,
            $conjecture->move_target_canonical_passage_id,
        ])));
        $anchorKeys = CanonicalPassage::whereIn('id', $anchorIds)->pluck('sort_key');

        if ($anchorKeys->count() !== count($anchorIds)) {
            return null;
        }

        $ids = EditionPassage::where('edition_id', $edition->id)
            ->where('part', 1)
            ->whereHas('canonicalPassage', fn ($query) => $query
                ->where('sort_key', '>=', $anchorKeys->min())
                ->where('sort_key', '<=', $anchorKeys->max()))
            ->with('canonicalPassage:id,sort_key')
            ->get()
            ->sortBy(fn (EditionPassage $row) => $row->canonicalPassage->sort_key)
            ->pluck('canonical_passage_id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        $sequence = TranspositionProjection::sequence($conjecture, array_values($ids));

        if ($sequence === null) {
            return null;
        }

        return array_map(fn (int $id) => ['canonical_passage_id' => $id, 'part' => 1, 'text' => null], $sequence);
    }

    /**
     * One row per part for every line the proposal divides — part 1 keeps
     * the existing row, its base and its lineation; the later parts flow
     * on from wherever they are put — and one row again for a line it
     * reads whole.
     *
     * @param  list<array{canonical_passage_id: int, part: int, text: string|null}>  $pieces
     */
    private static function divideLines(Edition $edition, array $pieces): void
    {
        $byPassage = [];

        foreach ($pieces as $piece) {
            $byPassage[$piece['canonical_passage_id']][$piece['part']] = $piece['text'];
        }

        foreach ($byPassage as $passageId => $parts) {
            $rows = EditionPassage::where('edition_id', $edition->id)
                ->where('canonical_passage_id', $passageId)
                ->orderBy('part')
                ->lockForUpdate()
                ->get();
            $first = $rows->first();

            if ($first === null) {
                throw ValidationException::withMessages([
                    'conjecture_id' => 'That proposal names a line this edition does not contain.',
                ]);
            }

            ksort($parts);
            $count = count($parts);

            foreach ($rows as $row) {
                if ($row->id !== $first->id && ($count === 1 || $row->part > $count)) {
                    $row->delete();
                }
            }

            $first->update(['part' => 1, 'part_text' => $count === 1 ? null : ($parts[1] ?? null)]);

            foreach ($parts as $part => $text) {
                if ($part === 1) {
                    continue;
                }

                EditionPassage::updateOrCreate(
                    ['edition_id' => $edition->id, 'canonical_passage_id' => $passageId, 'part' => $part],
                    [
                        'transcription_layer_id' => $first->transcription_layer_id,
                        'position' => (float) $first->position + $part / 1000,
                        'part_text' => $text,
                        'starts_new_line' => false,
                        'starts_new_paragraph' => false,
                    ],
                );
            }
        }
    }
}
