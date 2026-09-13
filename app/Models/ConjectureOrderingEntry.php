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
 * `Conjecture.segment_id` itself is only the set's first segment
 * by numbering order, kept as the usual anchor.
 *
 * A piece is normally a whole segment (`part` 1, `text` null). An
 * arrangement registered from the edition text by cutting PART of a line
 * and pasting it elsewhere divides that segment into pieces, numbered in
 * the segment's own content order, each carrying its words — the same
 * shape as a witness's split assignment (Assignment::part), and
 * reported by the same code (EditionController::assignmentDiscontinuities).
 *
 * @property int $id
 * @property int $conjecture_id
 * @property int $segment_id
 * @property int $part
 * @property int $sequence
 * @property string|null $text
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['conjecture_id', 'segment_id', 'part', 'sequence', 'text'])]
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
     * @return BelongsTo<Segment, $this>
     */
    public function segment(): BelongsTo
    {
        return $this->belongsTo(Segment::class);
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
