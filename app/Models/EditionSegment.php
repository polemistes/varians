<?php

namespace App\Models;

use Database\Factories\EditionSegmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A segment's membership in an edition — a segment is "in" an
 * edition iff it has a row here. `transcription_layer_id` is the transcription its
 * assignment was added from (nullable only for a whole-line lacuna, which has
 * no manuscript witness at all — see App\Support\Edition\SegmentAdder and
 * EditionVariantController's `new_segment` placement) and doubles as which
 * transcription's own wording is the display default for this segment.
 * `position` is the order the editor built the edition in — the manuscript's
 * own physical order for a bulk "base a range" add, never numbering order.
 *
 * `starts_new_line`/`starts_new_paragraph` are this edition's OWN lineation —
 * a display choice seeded once from the base transcription's newlines when
 * the segment is added (a convenience copy, never a live dependency on
 * manuscript layout) and freely rearranged afterwards. Breaks *inside* a
 * segment are EditionLineBreak rows.
 *
 * A segment the edition prints in PIECES — because it adopted a
 * transposition that moves part of the line elsewhere — has one row per
 * part: `part` numbers the pieces in the segment's own order, `part_text`
 * holds the piece's words (matched against the segment's runs when the
 * page renders, see EditionController::partRange), and each row has its
 * own position and lineation. A whole segment is a single part-1 row with
 * no text. See App\Support\Edition\ArrangementAdopter.
 *
 * @property int $id
 * @property int $edition_id
 * @property int $segment_id
 * @property int $part
 * @property int|null $transcription_layer_id
 * @property string $position
 * @property string|null $part_text
 * @property bool $starts_new_line
 * @property bool $starts_new_paragraph
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'segment_id', 'part', 'transcription_layer_id', 'position', 'part_text', 'starts_new_line', 'starts_new_paragraph'])]
class EditionSegment extends Model
{
    /** @use HasFactory<EditionSegmentFactory> */
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
     * @return BelongsTo<TranscriptionLayer, $this>
     */
    public function transcriptionLayer(): BelongsTo
    {
        return $this->belongsTo(TranscriptionLayer::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'part' => 'integer',
            'position' => 'decimal:10',
            'starts_new_line' => 'boolean',
            'starts_new_paragraph' => 'boolean',
        ];
    }
}
