<?php

namespace App\Support\Edition;

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\EditionTransposition;
use App\Models\Work;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * What each kind of conjecture must and must not carry — the one place
 * the rules live, shared by recording a conjecture and editing one (the
 * Work page's list edits every type, so both requests need the whole
 * matrix):
 *
 * - a substitution or supplement proposes `text`; a lacuna or deletion
 *   never does;
 * - a supplement names the lacuna it fills, on the same passage;
 * - a transposition states where a passage (or a range ending at
 *   `transposition_range_end_canonical_passage_id`) moves: before or after
 *   `move_target_canonical_passage_id`, outside the range;
 * - a reordering carries `canonical_passage_ids`, at least two, forming one
 *   contiguous stretch of the work's citation order, in the order proposed.
 *
 * All passages named must belong to the conjecture's work.
 */
class ConjectureShape
{
    /**
     * The field rules for the ordering kinds, layered on
     * ConjectureValidationRules::structuralRules by the requests.
     *
     * @return array<string, array<int, mixed>>
     */
    public static function orderingRules(Work $work, string $prefix = ''): array
    {
        $inWork = fn () => Rule::exists('canonical_passages', 'id')->where('work_id', $work->id);

        return [
            "{$prefix}transposition_range_end_canonical_passage_id" => ['nullable', 'integer', $inWork()],
            "{$prefix}move_target_canonical_passage_id" => ['nullable', 'integer', $inWork()],
            "{$prefix}move_position" => ['nullable', Rule::in(['before', 'after'])],
            "{$prefix}canonical_passage_ids" => ['nullable', 'array'],
            "{$prefix}canonical_passage_ids.*" => ['distinct', 'integer', $inWork()],
        ];
    }

    /**
     * Check a conjecture's fields as they WOULD stand — `$values` is the
     * merged picture (an existing record overlaid with the request), so an
     * edit that changes one field is judged against the whole.
     *
     * @param  array<string, mixed>  $values
     */
    public static function check(Validator $validator, array $values, Work $work, ?Conjecture $existing = null): void
    {
        $type = ConjectureType::tryFrom((string) ($values['type'] ?? ConjectureType::Substitution->value)) ?? ConjectureType::Substitution;
        $filled = fn (string $key): bool => isset($values[$key]) && $values[$key] !== '' && $values[$key] !== [];
        $passageId = (int) ($values['canonical_passage_id'] ?? 0);

        if ($existing !== null && $existing->type !== $type && self::isInUse($existing)) {
            $validator->errors()->add('type', 'This conjecture is placed in an edition or filled by a supplement — remove those first to change its kind.');
        }

        if (in_array($type, [ConjectureType::Substitution, ConjectureType::Supplement], true) && ! $filled('text')) {
            $validator->errors()->add('text', 'This needs proposed text.');
        }

        if ($type === ConjectureType::Lacuna && $filled('text')) {
            $validator->errors()->add('text', 'A lacuna never carries its own text — propose a supplement instead.');
        }

        if ($type === ConjectureType::Deletion && $filled('text')) {
            $validator->errors()->add('text', 'A deletion removes words — it carries no text of its own.');
        }

        if ($type === ConjectureType::Supplement) {
            $lacunaId = $values['supplements_conjecture_id'] ?? null;

            if (! is_numeric($lacunaId)) {
                $validator->errors()->add('supplements_conjecture_id', 'A supplement needs to name which lacuna it fills.');
            } else {
                $lacuna = Conjecture::find((int) $lacunaId);

                if ($lacuna !== null && $lacuna->canonical_passage_id !== $passageId) {
                    $validator->errors()->add('supplements_conjecture_id', 'That lacuna belongs to a different passage.');
                }
            }
        }

        if ($type === ConjectureType::Transposition) {
            self::checkTransposition($validator, $values, $work, $passageId);
        }

        if ($type === ConjectureType::Reordering) {
            self::checkReordering($validator, $values, $work);
        }
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private static function checkTransposition(Validator $validator, array $values, Work $work, int $passageId): void
    {
        $targetId = $values['move_target_canonical_passage_id'] ?? null;
        $endId = $values['transposition_range_end_canonical_passage_id'] ?? null;

        if (! is_numeric($targetId)) {
            $validator->errors()->add('move_target_canonical_passage_id', 'A transposition names the passage it moves before or after.');
        }

        if (! in_array($values['move_position'] ?? null, ['before', 'after'], true)) {
            $validator->errors()->add('move_position', 'Say whether the passage moves before or after its target.');
        }

        if (! is_numeric($targetId)) {
            return;
        }

        $start = CanonicalPassage::find($passageId);
        $end = is_numeric($endId) ? CanonicalPassage::find((int) $endId) : $start;
        $target = CanonicalPassage::find((int) $targetId);

        if ($start === null || $end === null || $target === null) {
            return;
        }

        if ($end->sort_key < $start->sort_key) {
            $validator->errors()->add('transposition_range_end_canonical_passage_id', 'The range\'s end must not come before its start.');
        }

        if ($target->sort_key >= $start->sort_key && $target->sort_key <= $end->sort_key) {
            $validator->errors()->add('move_target_canonical_passage_id', 'The target lies inside the moved range.');
        }
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private static function checkReordering(Validator $validator, array $values, Work $work): void
    {
        $ids = $values['canonical_passage_ids'] ?? null;

        if (! is_array($ids) || count($ids) < 2) {
            $validator->errors()->add('canonical_passage_ids', 'A reordering arranges at least two passages.');

            return;
        }

        $passages = $work->canonicalPassages()->whereIn('id', $ids)->get(['id', 'sort_key']);

        if ($passages->count() !== count($ids)) {
            return; // already reported by the per-item exists rule
        }

        $spanCount = $work->canonicalPassages()
            ->where('sort_key', '>=', $passages->min('sort_key'))
            ->where('sort_key', '<=', $passages->max('sort_key'))
            ->count();

        if ($spanCount !== count($ids)) {
            $validator->errors()->add('canonical_passage_ids', 'These passages must form one contiguous range of the citation order, with nothing left out.');
        }
    }

    /**
     * The first passage of a reordering by citation order — the passage
     * the record hangs from.
     *
     * @param  list<int|string>  $ids
     */
    public static function reorderingAnchor(Work $work, array $ids): ?int
    {
        $id = $work->canonicalPassages()->whereIn('id', $ids)->orderBy('sort_key')->value('id');

        return $id === null ? null : (int) $id;
    }

    /**
     * Whether a conjecture is woven into anything: placed as a reading,
     * adopted by an edition, or filled by a supplement.
     */
    public static function isInUse(Conjecture $conjecture): bool
    {
        return $conjecture->lemmaReadings()->exists()
            || $conjecture->suppliedBy()->exists()
            || EditionTransposition::where('conjecture_id', $conjecture->id)->exists();
    }

    /**
     * The values an edit would leave in place: the record's own, overlaid
     * with what the request sends.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public static function merged(Conjecture $conjecture, array $input): array
    {
        $current = [
            'type' => $conjecture->type->value,
            'canonical_passage_id' => $conjecture->canonical_passage_id,
            'text' => $conjecture->text,
            'extent' => $conjecture->extent,
            'extent_characters' => $conjecture->extent_characters,
            'supplements_conjecture_id' => $conjecture->supplements_conjecture_id,
            'transposition_range_end_canonical_passage_id' => $conjecture->transposition_range_end_canonical_passage_id,
            'move_target_canonical_passage_id' => $conjecture->move_target_canonical_passage_id,
            'move_position' => $conjecture->move_position,
            'canonical_passage_ids' => self::orderedPassageIds($conjecture),
        ];

        foreach ($input as $key => $value) {
            if (array_key_exists($key, $current)) {
                $current[$key] = $value;
            }
        }

        return $current;
    }

    /**
     * A reordering's passages in proposed order, each once — a passage
     * divided into parts (see ConjectureOrderingEntry) counts where its
     * first part stands, the way a witness's split citation does.
     *
     * @return list<int>
     */
    public static function orderedPassageIds(Conjecture $conjecture): array
    {
        return array_values($conjecture->orderingEntries()
            ->orderBy('sequence')
            ->pluck('canonical_passage_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->all());
    }

    /**
     * Replace a reordering's stored sequence with whole passages — any
     * division into parts is dropped; re-register from the edition text
     * to divide lines again.
     *
     * @param  Collection<int, mixed>|list<int|string>  $ids
     */
    public static function storeOrdering(Conjecture $conjecture, Collection|array $ids): void
    {
        $conjecture->orderingEntries()->delete();

        foreach (array_values(collect($ids)->all()) as $sequence => $id) {
            $conjecture->orderingEntries()->create([
                'canonical_passage_id' => (int) $id,
                'sequence' => $sequence,
            ]);
        }
    }
}
