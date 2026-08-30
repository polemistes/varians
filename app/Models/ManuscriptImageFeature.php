<?php

namespace App\Models;

use Database\Factories\ManuscriptImageFeatureFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A bounding box (normalized 0-1 fractions of the image) marking a non-textual
 * feature on a manuscript image — an illustration, damage, a marginal doodle —
 * unrelated to any transcribed text.
 *
 * @property int $id
 * @property int $manuscript_image_id
 * @property string $label
 * @property string $x
 * @property string $y
 * @property string $width
 * @property string $height
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['manuscript_image_id', 'label', 'x', 'y', 'width', 'height'])]
class ManuscriptImageFeature extends Model
{
    /** @use HasFactory<ManuscriptImageFeatureFactory> */
    use HasFactory;

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
            'x' => 'decimal:6',
            'y' => 'decimal:6',
            'width' => 'decimal:6',
            'height' => 'decimal:6',
        ];
    }
}
