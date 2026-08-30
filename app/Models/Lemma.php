<?php

namespace App\Models;

use Database\Factories\LemmaFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A slot within one CanonicalPassage — where competing readings (witness
 * spans or conjectures) are collated. Shared by every Edition of the work;
 * most passages get exactly one lemma spanning the whole thing (the simple,
 * common case stays simple), only splitting into several when readings need
 * to be mixed within the passage. Which candidate a given Edition prints is
 * recorded separately, on EditionLemma — collation is edition-independent
 * scholarship, selection is not. `position` is a real stored ordering
 * column (unlike TranscriptionSegment's offset-derived order), since a
 * lemma's candidate readings can come from unrelated transcriptions with
 * unrelated offsets.
 *
 * @property int $id
 * @property int $canonical_passage_id
 * @property string $position
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['canonical_passage_id', 'position'])]
class Lemma extends Model
{
    /** @use HasFactory<LemmaFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function canonicalPassage(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class);
    }

    /**
     * @return HasMany<LemmaReading, $this>
     */
    public function readings(): HasMany
    {
        return $this->hasMany(LemmaReading::class);
    }

    /**
     * @return HasMany<EditionLemma, $this>
     */
    public function editionSelections(): HasMany
    {
        return $this->hasMany(EditionLemma::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'position' => 'decimal:10',
        ];
    }
}
