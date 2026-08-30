<?php

namespace App\Models;

use App\Enums\ConjectureType;
use Database\Factories\ConjectureFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A recorded conjecture for a passage — the complete proposed reading, not
 * an offset-anchored span (there's no single "base" text to anchor to once
 * several witnesses and conjectures can all compete for the same lemma).
 * Kept directly on the passage, not only reachable via a reading, so an
 * editor can record one before committing to any lemma-splitting.
 *
 * Not every conjecture is a plain substitution — see ConjectureType. A
 * transposition/lacuna/supplement is still, at heart, an editorial proposal
 * that needs the same credit as a substitution — it uses the same
 * `proposed_by`/`bibliography` fields, never a separate mechanism.
 *
 * Most conjectures aren't the current editor's own idea — they're recording
 * one a scholar proposed long ago (`proposed_by`, e.g. "Bentley"), which is
 * deliberately separate from `user_id`: that stays attribution for who
 * entered this record into Varians, not who thought of it.
 *
 * @property int $id
 * @property int $canonical_passage_id
 * @property int $user_id
 * @property ConjectureType $type
 * @property string|null $text
 * @property string|null $extent
 * @property int|null $extent_characters
 * @property int|null $supplements_conjecture_id
 * @property int|null $transposition_range_end_canonical_passage_id
 * @property int|null $move_target_canonical_passage_id
 * @property string|null $move_position
 * @property string|null $proposed_by
 * @property string|null $bibliography
 * @property string|null $note
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'canonical_passage_id',
    'user_id',
    'type',
    'text',
    'extent',
    'extent_characters',
    'supplements_conjecture_id',
    'transposition_range_end_canonical_passage_id',
    'move_target_canonical_passage_id',
    'move_position',
    'proposed_by',
    'bibliography',
    'note',
])]
class Conjecture extends Model
{
    /** @use HasFactory<ConjectureFactory> */
    use HasFactory;

    protected $attributes = [
        'type' => ConjectureType::Substitution,
    ];

    /**
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function canonicalPassage(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The Lacuna this Supplement proposes to fill — only set when `type` is
     * Supplement.
     *
     * @return BelongsTo<Conjecture, $this>
     */
    public function supplements(): BelongsTo
    {
        return $this->belongsTo(Conjecture::class, 'supplements_conjecture_id');
    }

    /**
     * Every Supplement proposed for this Lacuna — several, from different
     * proposers, can compete to fill the same gap.
     *
     * @return HasMany<Conjecture, $this>
     */
    public function suppliedBy(): HasMany
    {
        return $this->hasMany(Conjecture::class, 'supplements_conjecture_id');
    }

    /**
     * The last passage of a moved range — only set when `type` is
     * Transposition and more than one passage moves together;
     * `canonical_passage_id` is always the range's first passage.
     *
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function transpositionRangeEnd(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class, 'transposition_range_end_canonical_passage_id');
    }

    /**
     * The passage a Transposition's range is proposed to move
     * `move_position` ('before'/'after') of — only set when `type` is
     * Transposition.
     *
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function moveTarget(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class, 'move_target_canonical_passage_id');
    }

    /**
     * @return HasMany<LemmaReading, $this>
     */
    public function lemmaReadings(): HasMany
    {
        return $this->hasMany(LemmaReading::class);
    }

    /**
     * The proposed sequence — only set when `type` is Reordering. Ordered
     * by `sequence`, not insertion order, since a reordering is always
     * authored as one complete, freshly-arranged list rather than grown
     * incrementally.
     *
     * @return HasMany<ConjectureOrderingEntry, $this>
     */
    public function orderingEntries(): HasMany
    {
        return $this->hasMany(ConjectureOrderingEntry::class)->orderBy('sequence');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => ConjectureType::class,
        ];
    }
}
