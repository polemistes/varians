<?php

namespace App\Models;

use Database\Factories\TranscriptionRegionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A bounding box (normalized 0-1 fractions of the image) linking a span of a
 * transcription's continuous text — a word, or as narrow as a single letter —
 * to where it appears on a manuscript image. Independent of citation spans;
 * the two annotate the same text for unrelated purposes.
 *
 * @property int $id
 * @property int $transcription_id
 * @property int $manuscript_image_id
 * @property string $text
 * @property int $start_offset
 * @property int $end_offset
 * @property string $position
 * @property string $x
 * @property string $y
 * @property string $width
 * @property string $height
 * @property bool $needs_review
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['transcription_id', 'manuscript_image_id', 'text', 'start_offset', 'end_offset', 'position', 'x', 'y', 'width', 'height', 'needs_review'])]
class TranscriptionRegion extends Model
{
    /** @use HasFactory<TranscriptionRegionFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Transcription, $this>
     */
    public function transcription(): BelongsTo
    {
        return $this->belongsTo(Transcription::class);
    }

    /**
     * @return BelongsTo<ManuscriptImage, $this>
     */
    public function manuscriptImage(): BelongsTo
    {
        return $this->belongsTo(ManuscriptImage::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'start_offset' => 'integer',
            'end_offset' => 'integer',
            'position' => 'decimal:10',
            'x' => 'decimal:6',
            'y' => 'decimal:6',
            'width' => 'decimal:6',
            'height' => 'decimal:6',
            'needs_review' => 'boolean',
        ];
    }
}
