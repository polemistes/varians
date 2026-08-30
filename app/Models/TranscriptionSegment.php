<?php

namespace App\Models;

use Database\Factories\TranscriptionSegmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A citation-span annotation over its parent Transcription's continuous
 * `text` — not an owner of text itself. Physical reading order is simply the
 * span's position within that string; citation order lives independently in
 * canonical_passage.sort_key, so the two can diverge (transpositions).
 *
 * A segment always cites a canonical passage — there's no "marked but
 * unassigned" state. A span with no citation has no use to anyone, so it's
 * either given one at creation or never created at all.
 *
 * @property int $id
 * @property int $transcription_id
 * @property int $canonical_passage_id
 * @property int $start_offset
 * @property int $end_offset
 * @property bool $needs_review
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['transcription_id', 'canonical_passage_id', 'start_offset', 'end_offset', 'needs_review'])]
class TranscriptionSegment extends Model
{
    /** @use HasFactory<TranscriptionSegmentFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Transcription, $this>
     */
    public function transcription(): BelongsTo
    {
        return $this->belongsTo(Transcription::class);
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
            'start_offset' => 'integer',
            'end_offset' => 'integer',
            'needs_review' => 'boolean',
        ];
    }
}
