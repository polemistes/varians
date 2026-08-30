<?php

namespace App\Support\Edition;

use App\Enums\ConjectureType;
use App\Models\Conjecture;
use LogicException;

/**
 * Resolves the three-way "source" a new LemmaReading comes from — a witness
 * span, an existing catalogued Conjecture, or a brand new one recorded on
 * the spot. Used by EditionVariantController::store, the single place a
 * reading now gets attached to a Lemma.
 */
class ReadingSourceResolver
{
    /**
     * @param  array<string, mixed>  $data  the request's validated() array
     * @return array<string, mixed>
     */
    public static function resolve(array $data, int $canonicalPassageId, int $userId): array
    {
        return match ($data['source']) {
            'transcription' => [
                'transcription_id' => $data['transcription_id'],
                'start_offset' => $data['start_offset'],
                'end_offset' => $data['end_offset'],
            ],
            'existing_conjecture' => [
                'conjecture_id' => $data['conjecture_id'],
            ],
            'new_conjecture' => [
                'conjecture_id' => Conjecture::create([
                    'canonical_passage_id' => $canonicalPassageId,
                    'user_id' => $userId,
                    'type' => $data['conjecture_type'] ?? ConjectureType::Substitution->value,
                    'text' => $data['conjecture_text'] ?? null,
                    'extent' => $data['conjecture_extent'] ?? null,
                    'extent_characters' => $data['conjecture_extent_characters'] ?? null,
                    'supplements_conjecture_id' => $data['conjecture_supplements_conjecture_id'] ?? null,
                    'proposed_by' => $data['conjecture_proposed_by'] ?? null,
                    'bibliography' => $data['conjecture_bibliography'] ?? null,
                    'note' => $data['conjecture_note'] ?? null,
                ])->id,
            ],
            default => throw new LogicException('Unreachable: source is validated against a fixed list of values.'),
        };
    }
}
