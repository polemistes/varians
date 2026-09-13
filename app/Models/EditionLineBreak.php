<?php

namespace App\Models;

use Database\Factories\EditionLineBreakFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A line (or paragraph) break INSIDE a segment, before one collation column
 * — this edition's own colometry. The lyric parts of a drama divide into
 * lines differently in every edition, so where a segment's text breaks is an
 * editorial display choice scoped to one Edition, exactly like an
 * EditionLemma is one edition's reading choice. Breaks between segments are
 * `EditionSegment.starts_new_line`/`starts_new_paragraph`.
 *
 * `lemma_id` cascades rather than degrading (contrast EditionComment): a
 * break with no column means nothing. To keep that cascade from silently
 * destroying colometry, breaks count as editorial content — they pin the
 * segment's column structure against rebuilds (see
 * SegmentAligner::hasEditorialContent and realignLayer).
 *
 * @property int $id
 * @property int $edition_id
 * @property int $segment_id
 * @property int $lemma_id
 * @property string $kind
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'segment_id', 'lemma_id', 'kind'])]
class EditionLineBreak extends Model
{
    /** @use HasFactory<EditionLineBreakFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Edition, $this>
     */
    public function edition(): BelongsTo
    {
        return $this->belongsTo(Edition::class);
    }

    /**
     * @return BelongsTo<Segment, $this>
     */
    public function segment(): BelongsTo
    {
        return $this->belongsTo(Segment::class);
    }

    /**
     * The column this break stands before.
     *
     * @return BelongsTo<Lemma, $this>
     */
    public function lemma(): BelongsTo
    {
        return $this->belongsTo(Lemma::class);
    }
}
