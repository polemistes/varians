<?php

namespace App\Models;

use Database\Factories\EditionLemmaFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Which of a Lemma's candidate LemmaReadings a given Edition currently
 * prints — a thin per-edition selection, not an owner of readings. The
 * lemma/reading collation itself lives on Lemma/LemmaReading, shared by
 * every edition of the work; this row's mere existence *is* "this edition
 * has picked something for this lemma" — there's no separate "in scope but
 * undecided" state, since "no row" already means undecided (hence
 * `selected_reading_id` is not nullable, and cascades: losing the picked
 * reading means losing the pick).
 *
 * @property int $id
 * @property int $edition_id
 * @property int $lemma_id
 * @property int $selected_reading_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'lemma_id', 'selected_reading_id'])]
class EditionLemma extends Model
{
    /** @use HasFactory<EditionLemmaFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Edition, $this>
     */
    public function edition(): BelongsTo
    {
        return $this->belongsTo(Edition::class);
    }

    /**
     * @return BelongsTo<Lemma, $this>
     */
    public function lemma(): BelongsTo
    {
        return $this->belongsTo(Lemma::class);
    }

    /**
     * @return BelongsTo<LemmaReading, $this>
     */
    public function selectedReading(): BelongsTo
    {
        return $this->belongsTo(LemmaReading::class, 'selected_reading_id');
    }
}
