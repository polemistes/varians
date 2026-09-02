<?php

namespace App\Models;

use Database\Factories\EditionPassageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A canonical passage's membership in an edition — a passage is "in" an
 * edition iff it has a row here. `transcription_layer_id` is the transcription its
 * segment was added from (nullable only for a whole-line lacuna, which has
 * no manuscript witness at all — see App\Support\Edition\PassageAdder and
 * EditionVariantController's `new_passage` placement) and doubles as which
 * transcription's own wording is the display default for this passage.
 * `position` is the order the editor built the edition in — the manuscript's
 * own physical order for a bulk "base a range" add, never citation order.
 *
 * `starts_new_line`/`starts_new_paragraph` are this edition's OWN lineation —
 * a display choice seeded once from the base transcription's newlines when
 * the passage is added (a convenience copy, never a live dependency on
 * manuscript layout) and freely rearranged afterwards. Breaks *inside* a
 * passage are EditionLineBreak rows.
 *
 * @property int $id
 * @property int $edition_id
 * @property int $canonical_passage_id
 * @property int|null $transcription_layer_id
 * @property string $position
 * @property bool $starts_new_line
 * @property bool $starts_new_paragraph
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'canonical_passage_id', 'transcription_layer_id', 'position', 'starts_new_line', 'starts_new_paragraph'])]
class EditionPassage extends Model
{
    /** @use HasFactory<EditionPassageFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Edition, $this>
     */
    public function edition(): BelongsTo
    {
        return $this->belongsTo(Edition::class);
    }

    /**
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function canonicalPassage(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class);
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
            'position' => 'decimal:10',
            'starts_new_line' => 'boolean',
            'starts_new_paragraph' => 'boolean',
        ];
    }
}
