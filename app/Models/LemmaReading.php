<?php

namespace App\Models;

use Database\Factories\LemmaReadingFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One candidate reading attached to a Lemma — either an ad-hoc span
 * directly into one transcription's continuous text (its own offsets, not
 * required to fall inside any existing TranscriptionSegment's boundaries),
 * or a Conjecture. Exactly one of the two is set. Shared by every Edition —
 * see Lemma for why collation and edition-selection are kept separate.
 *
 * `range_end_lemma_id` is set when this one reading spans more than its own
 * `lemma_id` column — an editor's multi-word conjecture, or a witness's own
 * reading when PassageAligner finds it doesn't decompose 1-for-1 against the
 * passage's existing columns. The lemmas in between are never touched,
 * merged, or deleted by this — they keep their own independent readings for
 * every other witness/edition; only rendering collapses the span when this
 * particular reading is the one selected.
 *
 * @property int $id
 * @property int $lemma_id
 * @property int|null $transcription_id
 * @property int|null $start_offset
 * @property int|null $end_offset
 * @property int|null $conjecture_id
 * @property int|null $range_end_lemma_id
 * @property bool $needs_review
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['lemma_id', 'transcription_id', 'start_offset', 'end_offset', 'conjecture_id', 'range_end_lemma_id', 'needs_review'])]
class LemmaReading extends Model
{
    /** @use HasFactory<LemmaReadingFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Lemma, $this>
     */
    public function lemma(): BelongsTo
    {
        return $this->belongsTo(Lemma::class);
    }

    /**
     * @return BelongsTo<Transcription, $this>
     */
    public function transcription(): BelongsTo
    {
        return $this->belongsTo(Transcription::class);
    }

    /**
     * @return BelongsTo<Conjecture, $this>
     */
    public function conjecture(): BelongsTo
    {
        return $this->belongsTo(Conjecture::class);
    }

    /**
     * @return BelongsTo<Lemma, $this>
     */
    public function rangeEndLemma(): BelongsTo
    {
        return $this->belongsTo(Lemma::class, 'range_end_lemma_id');
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
