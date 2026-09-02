<?php

namespace App\Models;

use Database\Factories\TranscriptionSegmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * A citation-span annotation over its parent TranscriptionLayer's continuous
 * `text` — not an owner of text itself. Physical reading order is simply the
 * span's position within that string; citation order lives independently in
 * canonical_passage.sort_key, so the two can diverge (transpositions).
 *
 * A segment always cites a canonical passage — there's no "marked but
 * unassigned" state. A span with no citation has no use to anyone, so it's
 * either given one at creation or never created at all.
 *
 * One passage's witness text can be physically discontinuous — a scribe
 * transposing half a line splits it across two places — so several spans in
 * one layer may cite the same passage. `part` orders those spans by
 * *content* (which fragment is the first half of the line), a claim
 * independent of the physical order their offsets give; the two disagreeing
 * is exactly what a sub-passage transposition is. Consume parts via
 * `scopeInPartOrder`/`sortByPartOrder` so every reader concatenates them the
 * same way.
 *
 * @property int $id
 * @property int $transcription_layer_id
 * @property int $canonical_passage_id
 * @property int $start_offset
 * @property int $end_offset
 * @property int $part
 * @property bool $needs_review
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['transcription_layer_id', 'canonical_passage_id', 'start_offset', 'end_offset', 'part', 'needs_review'])]
class TranscriptionSegment extends Model
{
    /** @use HasFactory<TranscriptionSegmentFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<TranscriptionLayer, $this>
     */
    public function transcriptionLayer(): BelongsTo
    {
        return $this->belongsTo(TranscriptionLayer::class);
    }

    /**
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function canonicalPassage(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class);
    }

    /**
     * Content order — the order the parts read in as text of their passage.
     * `start_offset` only tiebreaks spans that predate part numbering or
     * were left equal; it must never override an explicit difference in
     * `part`, or a transposed fragment would read in physical order again.
     *
     * @param  Builder<TranscriptionSegment>  $query
     * @return Builder<TranscriptionSegment>
     */
    public function scopeInPartOrder(Builder $query): Builder
    {
        return $query->orderBy('part')->orderBy('start_offset');
    }

    /**
     * The same content order for an already-loaded collection.
     *
     * @param  Collection<int, TranscriptionSegment>  $segments
     * @return Collection<int, TranscriptionSegment>
     */
    public static function sortByPartOrder(Collection $segments): Collection
    {
        return $segments
            ->sortBy(fn (TranscriptionSegment $segment) => [$segment->part, $segment->start_offset])
            ->values();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'start_offset' => 'integer',
            'end_offset' => 'integer',
            'part' => 'integer',
            'needs_review' => 'boolean',
        ];
    }
}
