<?php

namespace App\Models;

use Database\Factories\ManuscriptFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $witness_id
 * @property string|null $repository
 * @property string|null $shelfmark
 * @property string|null $date_text
 * @property string|null $notes
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['witness_id', 'repository', 'shelfmark', 'date_text', 'notes'])]
class Manuscript extends Model
{
    /** @use HasFactory<ManuscriptFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Witness, $this>
     */
    public function witness(): BelongsTo
    {
        return $this->belongsTo(Witness::class);
    }

    /**
     * @return HasMany<ManuscriptPage, $this>
     */
    public function pages(): HasMany
    {
        return $this->hasMany(ManuscriptPage::class);
    }

    /**
     * @return HasMany<ManuscriptImage, $this>
     */
    public function images(): HasMany
    {
        return $this->hasMany(ManuscriptImage::class);
    }
}
