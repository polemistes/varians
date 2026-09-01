<?php

namespace App\Models;

use Database\Factories\EditionPassageOrderFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Which source's own internal sequence a given edition has chosen to follow
 * for a whole range of passages (`range_start`..`range_end`, inclusive, by
 * this edition's own position order) — a thin per-edition selection,
 * mirroring EditionLemma: a row's mere existence *is* "this edition follows
 * this order here." The source is either a transcription's own physical
 * order (`transcription_layer_id`) or a catalogued ConjectureType::Reordering
 * (`conjecture_id`) — exactly one is ever set, mirroring LemmaReading's
 * identical transcription-xor-conjecture duality. The transcription case
 * never touches Conjecture at all: the manuscript itself is the source,
 * not a proposer, so there's nothing to name — `user_id` is only who in
 * Varians recorded the choice.
 *
 * @property int $id
 * @property int $edition_id
 * @property int $range_start_canonical_passage_id
 * @property int $range_end_canonical_passage_id
 * @property int|null $transcription_layer_id
 * @property int|null $conjecture_id
 * @property int $user_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'range_start_canonical_passage_id', 'range_end_canonical_passage_id', 'transcription_layer_id', 'conjecture_id', 'user_id'])]
class EditionPassageOrder extends Model
{
    /** @use HasFactory<EditionPassageOrderFactory> */
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
    public function rangeStart(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class, 'range_start_canonical_passage_id');
    }

    /**
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function rangeEnd(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class, 'range_end_canonical_passage_id');
    }

    /**
     * The witness whose own attested order this choice follows — null when
     * `conjecture_id` is set instead.
     *
     * @return BelongsTo<TranscriptionLayer, $this>
     */
    public function transcriptionLayer(): BelongsTo
    {
        return $this->belongsTo(TranscriptionLayer::class);
    }

    /**
     * The catalogued Reordering conjecture this choice follows — null when
     * `transcription_layer_id` is set instead.
     *
     * @return BelongsTo<Conjecture, $this>
     */
    public function conjecture(): BelongsTo
    {
        return $this->belongsTo(Conjecture::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
