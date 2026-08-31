<?php

namespace App\Models;

use App\Enums\Role;
use App\Enums\Visibility;
use Database\Factories\EditionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One of a Work's critical texts, built up passage by passage by selecting,
 * for each shared Lemma it has an opinion on, which of that lemma's
 * candidate LemmaReadings to print (see EditionLemma) — unlike
 * Witness<->Work, this is a genuine direct relation: an Edition is an
 * editorial artifact the editor explicitly creates for a work, not
 * something inferable from citation data.
 *
 * @property int $id
 * @property int $work_id
 * @property int $user_id
 * @property string $title
 * @property string|null $description
 * @property Visibility $visibility
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['work_id', 'user_id', 'title', 'description', 'visibility'])]
class Edition extends Model
{
    /** @use HasFactory<EditionFactory> */
    use HasFactory;

    protected $attributes = [
        'visibility' => Visibility::Draft,
    ];

    /**
     * @return BelongsTo<Work, $this>
     */
    public function work(): BelongsTo
    {
        return $this->belongsTo(Work::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * This edition's selections — which reading it currently prints for
     * each Lemma it has decided. Not the shared lemma/reading collation
     * itself; see Lemma/LemmaReading for that.
     *
     * @return HasMany<EditionLemma, $this>
     */
    public function selections(): HasMany
    {
        return $this->hasMany(EditionLemma::class);
    }

    /**
     * This edition's scope, order, and per-passage source transcription —
     * a passage is "in" this edition iff it has a row here, see
     * EditionPassage.
     *
     * @return HasMany<EditionPassage, $this>
     */
    public function passages(): HasMany
    {
        return $this->hasMany(EditionPassage::class);
    }

    /**
     * Which transposition proposals this edition has adopted — changes its
     * passage rendering order, see EditionTransposition.
     *
     * @return HasMany<EditionTransposition, $this>
     */
    public function transpositions(): HasMany
    {
        return $this->hasMany(EditionTransposition::class);
    }

    /**
     * This edition's own notes on points in the text — see EditionComment.
     *
     * @return HasMany<EditionComment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(EditionComment::class);
    }

    /**
     * Scope a query to editions visible to the given viewer: editors and
     * administrators see everything; everyone else only sees published ones.
     *
     * @param  Builder<Edition>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->where('visibility', Visibility::Published);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'visibility' => Visibility::class,
        ];
    }
}
