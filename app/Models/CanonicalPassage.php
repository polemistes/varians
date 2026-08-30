<?php

namespace App\Models;

use Database\Factories\CanonicalPassageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $work_id
 * @property array<string, int|string> $address
 * @property string $sort_key
 * @property string $label
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['work_id', 'address', 'sort_key', 'label'])]
class CanonicalPassage extends Model
{
    /** @use HasFactory<CanonicalPassageFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Work, $this>
     */
    public function work(): BelongsTo
    {
        return $this->belongsTo(Work::class);
    }

    /**
     * @return HasMany<TranscriptionSegment, $this>
     */
    public function transcriptionSegments(): HasMany
    {
        return $this->hasMany(TranscriptionSegment::class);
    }

    /**
     * @return HasMany<Conjecture, $this>
     */
    public function conjectures(): HasMany
    {
        return $this->hasMany(Conjecture::class);
    }

    /**
     * The shared lemma collation for this passage — every Edition of the
     * work draws its selections from these, see Lemma.
     *
     * @return HasMany<Lemma, $this>
     */
    public function lemmas(): HasMany
    {
        return $this->hasMany(Lemma::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'address' => 'array',
        ];
    }
}
