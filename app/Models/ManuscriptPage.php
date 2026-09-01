<?php

namespace App\Models;

use Database\Factories\ManuscriptPageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One page of a manuscript — a leaf side, a column-less opening, whatever the
 * scholar counts as a page — named by `label` ("12r", "f. 3v", "p. 118").
 *
 * A page exists whether or not anyone has photographed it: a transcription is
 * often made from a printed facsimile, a microfilm, or the manuscript itself,
 * and its text still has to be divided onto pages. Images attach to a page
 * later, or never.
 *
 * @property int $id
 * @property int $manuscript_id
 * @property string $label
 * @property float $position
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['manuscript_id', 'label', 'position'])]
class ManuscriptPage extends Model
{
    /** @use HasFactory<ManuscriptPageFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Manuscript, $this>
     */
    public function manuscript(): BelongsTo
    {
        return $this->belongsTo(Manuscript::class);
    }

    /**
     * @return HasMany<ManuscriptImage, $this>
     */
    public function images(): HasMany
    {
        return $this->hasMany(ManuscriptImage::class);
    }

    /**
     * Where this page begins in each layer that has placed it.
     *
     * @return HasMany<TranscriptionPageBreak, $this>
     */
    public function pageBreaks(): HasMany
    {
        return $this->hasMany(TranscriptionPageBreak::class);
    }
}
