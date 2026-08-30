<?php

namespace App\Models;

use Database\Factories\EditionTranspositionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Which transposition proposals a given edition has adopted — a thin
 * per-edition adoption, mirroring EditionLemma except boolean rather than a
 * selection: a row's mere existence *is* "this edition prints its passages
 * in this moved order." The shared Conjecture(type: transposition) is
 * untouched by adopting or un-adopting it here.
 *
 * @property int $id
 * @property int $edition_id
 * @property int $conjecture_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'conjecture_id'])]
class EditionTransposition extends Model
{
    /** @use HasFactory<EditionTranspositionFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Edition, $this>
     */
    public function edition(): BelongsTo
    {
        return $this->belongsTo(Edition::class);
    }

    /**
     * @return BelongsTo<Conjecture, $this>
     */
    public function conjecture(): BelongsTo
    {
        return $this->belongsTo(Conjecture::class);
    }
}
