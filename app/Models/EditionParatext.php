<?php

namespace App\Models;

use App\Enums\ParatextKind;
use Database\Factories\EditionParatextFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Paratext: what this edition prints beside or among the words of the text
 * without its being text of the work — a marginal note, an inline remark,
 * a speaker's name in a dialogue. It has a POSITION in the text and no
 * other relation to it: it changes no reading, enters no apparatus, and
 * is not collated. Scoped to one Edition, like a comment or a line break.
 *
 * The position is a point between words: `placement` 'before' or 'after'
 * the collation column `lemma_id` of `segment_id`. Several paratexts at
 * the same point read in `position` order. `lemma_id` cascades, and the
 * paratext pins the column against rebuilds instead (see
 * SegmentAligner::hasEditorialContent); removing the segment from the
 * edition removes it too.
 *
 * @property int $id
 * @property int $edition_id
 * @property int $segment_id
 * @property int $lemma_id
 * @property string $placement
 * @property ParatextKind $kind
 * @property string $text
 * @property int $position
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'segment_id', 'lemma_id', 'placement', 'kind', 'text', 'position'])]
class EditionParatext extends Model
{
    /** @use HasFactory<EditionParatextFactory> */
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
     * The column this paratext stands before or after.
     *
     * @return BelongsTo<Lemma, $this>
     */
    public function lemma(): BelongsTo
    {
        return $this->belongsTo(Lemma::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => ParatextKind::class,
            'position' => 'integer',
        ];
    }
}
