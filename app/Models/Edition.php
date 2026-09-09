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
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * One of a Work's critical texts, built up passage by passage by selecting,
 * for each shared Lemma it has an opinion on, which of that lemma's
 * candidate LemmaReadings to print (see EditionLemma) — unlike
 * Witness<->Work, this is a genuine direct relation: an Edition is an
 * editorial artifact the editor explicitly creates for a work, not
 * something inferable from citation data.
 *
 * `user_id` is the OWNER: the one member who may publish, delete, invite
 * editors (`editors()`) and hand the edition on (`ownershipTransfers()`).
 * See EditionPolicy for what each of those allows.
 *
 * @property int $id
 * @property int $work_id
 * @property int $user_id
 * @property int|null $copied_from_id
 * @property string $title
 * @property string|null $description
 * @property Visibility $visibility
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['work_id', 'user_id', 'copied_from_id', 'title', 'description', 'visibility'])]
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
     * The owner.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The edition this one was copied from, when it is a copy — see
     * App\Support\Copying\EditionCopier.
     *
     * @return BelongsTo<Edition, $this>
     */
    public function copiedFrom(): BelongsTo
    {
        return $this->belongsTo(Edition::class, 'copied_from_id');
    }

    /**
     * The members the owner has invited to edit this edition — and with it
     * the witnesses and conjectures connected to its work.
     *
     * @return BelongsToMany<User, $this>
     */
    public function editors(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'edition_editors')
            ->withPivot('granted_by_id')
            ->withTimestamps();
    }

    /**
     * Offers to hand this edition to another member, open and settled —
     * see EditionOwnershipTransfer.
     *
     * @return HasMany<EditionOwnershipTransfer, $this>
     */
    public function ownershipTransfers(): HasMany
    {
        return $this->hasMany(EditionOwnershipTransfer::class);
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
     * Whether this member may edit the edition: its owner or an invited
     * editor. Site-wide roles are the policies' business, not this one's.
     */
    public function isEditableBy(User $user): bool
    {
        return $this->user_id === $user->id
            || $this->editors()->whereKey($user->id)->exists();
    }

    public function isPublished(): bool
    {
        return $this->visibility === Visibility::Published;
    }

    /**
     * Scope a query to editions the given member may edit — the SQL form
     * of isEditableBy(), for lists.
     *
     * @param  Builder<Edition>  $query
     */
    #[Scope]
    protected function editableBy(Builder $query, User $user): void
    {
        $query->where(function (Builder $query) use ($user) {
            $query->where('editions.user_id', $user->id)
                ->orWhereIn('editions.id', DB::table('edition_editors')->where('user_id', $user->id)->select('edition_id'));
        });
    }

    /**
     * Scope a query to editions visible to the given viewer: editors and
     * administrators see everything; a member also sees what she may edit;
     * everyone sees the published ones.
     *
     * @param  Builder<Edition>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->where(function (Builder $query) use ($viewer) {
            $query->where('editions.visibility', Visibility::Published);

            if ($viewer !== null) {
                $query->orWhereIn('editions.id', Edition::query()->editableBy($viewer)->select('editions.id'));
            }
        });
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
