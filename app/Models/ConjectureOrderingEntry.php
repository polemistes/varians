<?php

namespace App\Models;

use Database\Factories\ConjectureOrderingEntryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One piece's rank within a ConjectureType::Reordering's proposed
 * sequence — the authoritative set-and-order for that conjecture;
 * `Conjecture.canonical_passage_id` itself is only the set's first passage
 * by citation order, kept as the usual anchor.
 *
 * A piece is normally a whole passage (`part` 1, `text` null). An
 * arrangement registered from the edition text by cutting PART of a line
 * and pasting it elsewhere divides that passage into pieces, numbered in
 * the passage's own content order, each carrying its words — the same
 * shape as a witness's split citation (TranscriptionSegment::part), and
 * reported by the same code (EditionController::citationDiscontinuities).
 *
 * @property int $id
 * @property int $conjecture_id
 * @property int $canonical_passage_id
 * @property int $part
 * @property int $sequence
 * @property string|null $text
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['conjecture_id', 'canonical_passage_id', 'part', 'sequence', 'text'])]
class ConjectureOrderingEntry extends Model
{
    /** @use HasFactory<ConjectureOrderingEntryFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Conjecture, $this>
     */
    public function conjecture(): BelongsTo
    {
        return $this->belongsTo(Conjecture::class);
    }

    /**
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function canonicalPassage(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'part' => 'integer',
            'sequence' => 'integer',
        ];
    }
}
