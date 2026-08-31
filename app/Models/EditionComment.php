<?php

namespace App\Models;

use Database\Factories\EditionCommentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An editor's free-text note on a point in her own edition.
 *
 * Collation reports what the witnesses read; this reports what the *editor*
 * has to say about it. It carries the judgments the apparatus's own vocabulary
 * cannot: that two manuscripts differ in accentuation, breathing or word
 * division in a way worth reporting rather than silently normalizing; which
 * speaker a line belongs to in a dialogue, where the manuscripts disagree or
 * are silent; why this edition prints what it prints. Deliberately free text —
 * these are matters of judgment, and prescribing a vocabulary for them would
 * be prescribing the scholarship.
 *
 * Scoped to one `Edition`, like `EditionLemma`: two editions of a work can say
 * different things about the same word, and a note justifying a choice belongs
 * to the edition that made it.
 *
 * A note always names a `CanonicalPassage`. `lemma_id` narrows it to one
 * column, and `range_end_lemma_id` widens that to a span — the same shape
 * `LemmaReading` uses. With `lemma_id` null the note is about the passage as
 * a whole, which is what a speaker assignment usually is.
 *
 * @property int $id
 * @property int $edition_id
 * @property int $canonical_passage_id
 * @property int|null $lemma_id
 * @property int|null $range_end_lemma_id
 * @property int $user_id
 * @property string $note
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['edition_id', 'canonical_passage_id', 'lemma_id', 'range_end_lemma_id', 'user_id', 'note'])]
class EditionComment extends Model
{
    /** @use HasFactory<EditionCommentFactory> */
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
     * @return BelongsTo<Lemma, $this>
     */
    public function lemma(): BelongsTo
    {
        return $this->belongsTo(Lemma::class);
    }

    /**
     * @return BelongsTo<Lemma, $this>
     */
    public function rangeEndLemma(): BelongsTo
    {
        return $this->belongsTo(Lemma::class, 'range_end_lemma_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
