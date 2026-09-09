<?php

namespace App\Models;

use App\Enums\Role;
use App\Enums\Tokenization;
use App\Enums\Visibility;
use Database\Factories\WorkFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Support\Carbon;

/**
 * A work is the hub every privilege runs through: a witness or a conjecture
 * is editable by whoever may edit a work it is connected to, and a work is
 * editable by its owner and by the owner or invited editors of any of its
 * editions — that is how a grant on an edition reaches "the witnesses and
 * conjectures pertaining to it" (see WorkPolicy).
 *
 * @property int $id
 * @property int|null $user_id
 * @property int|null $copied_from_id
 * @property int $reference_scheme_id
 * @property string $title
 * @property string|null $author
 * @property string $language
 * @property Tokenization $tokenization
 * @property string $slug
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['user_id', 'copied_from_id', 'reference_scheme_id', 'title', 'author', 'language', 'tokenization', 'slug'])]
class Work extends Model
{
    /** @use HasFactory<WorkFactory> */
    use HasFactory;

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'tokenization' => Tokenization::Whitespace,
    ];

    /**
     * The owner — the member who registered the work, or was handed it.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The work this one was copied from, when it is a copy — see
     * App\Support\Copying\EditionCopier.
     *
     * @return BelongsTo<Work, $this>
     */
    public function copiedFrom(): BelongsTo
    {
        return $this->belongsTo(Work::class, 'copied_from_id');
    }

    /**
     * @return BelongsTo<ReferenceScheme, $this>
     */
    public function referenceScheme(): BelongsTo
    {
        return $this->belongsTo(ReferenceScheme::class);
    }

    /**
     * @return HasMany<CanonicalPassage, $this>
     */
    public function canonicalPassages(): HasMany
    {
        return $this->hasMany(CanonicalPassage::class);
    }

    /**
     * Every assignment of a stretch of some witness's text to one of this
     * work's passages. This, rather than the passages themselves, is what a
     * scholar spends her time on and what she would lose: a work of a hundred
     * lines collated from seven manuscripts holds seven hundred of these.
     *
     * @return HasManyThrough<TranscriptionSegment, CanonicalPassage, $this>
     */
    public function transcriptionSegments(): HasManyThrough
    {
        return $this->hasManyThrough(TranscriptionSegment::class, CanonicalPassage::class);
    }

    /**
     * Unlike Witness/TranscriptionLayer, an Edition is a real, direct relation —
     * an editorial artifact the editor explicitly creates for a work, not
     * something inferable from citation data.
     *
     * @return HasMany<Edition, $this>
     */
    public function editions(): HasMany
    {
        return $this->hasMany(Edition::class);
    }

    /**
     * Every conjecture recorded against one of this work's passages.
     *
     * @return HasManyThrough<Conjecture, CanonicalPassage, $this>
     */
    public function conjectures(): HasManyThrough
    {
        return $this->hasManyThrough(Conjecture::class, CanonicalPassage::class);
    }

    /**
     * Witnesses connected to this work — derived, not stored: a witness is
     * related to a work only once one of its transcriptions has a segment
     * citing one of the work's canonical passages.
     *
     * @return Builder<Witness>
     */
    public function relatedWitnesses(): Builder
    {
        return Witness::query()->whereHas(
            'transcriptionLayers.segments.canonicalPassage',
            fn (Builder $query) => $query->where('work_id', $this->id),
        );
    }

    /**
     * Whether this member may edit the work and everything connected to it:
     * its owner, and the owner or an invited editor of any of its editions.
     * Site-wide roles are the policies' business, not this one's.
     */
    public function isEditableBy(User $user): bool
    {
        return $this->user_id === $user->id
            || $this->editions()->editableBy($user)->exists();
    }

    /**
     * Whether readers at large may see the work: an edition of it is
     * published, or a published transcription cites one of its passages.
     */
    public function isPublished(): bool
    {
        return $this->editions()->where('visibility', Visibility::Published)->exists()
            || $this->canonicalPassages()
                ->whereHas('transcriptionSegments.transcriptionLayer.transcription', fn (Builder $query) => $query->where('visibility', Visibility::Published))
                ->exists();
    }

    /**
     * Scope a query to works the given member may edit — the SQL form of
     * isEditableBy(), for lists.
     *
     * @param  Builder<Work>  $query
     */
    #[Scope]
    protected function editableBy(Builder $query, User $user): void
    {
        $query->where(function (Builder $query) use ($user) {
            $query->where('works.user_id', $user->id)
                ->orWhereIn('works.id', Edition::query()->editableBy($user)->select('editions.work_id'));
        });
    }

    /**
     * Scope a query to works the given member may cite into or otherwise
     * edit: everything for a site-wide editor, else editableBy().
     *
     * @param  Builder<Work>  $query
     */
    #[Scope]
    protected function editableOrAllFor(Builder $query, User $user): void
    {
        if ($user->hasRole(Role::Editor)) {
            return;
        }

        $query->editableBy($user);
    }

    /**
     * Scope a query to works visible to the given viewer: editors and
     * administrators see everything; a member also sees what she may edit;
     * everyone sees a work with a published edition or with at least one
     * published transcription citing one of its passages.
     *
     * @param  Builder<Work>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->where(function (Builder $query) use ($viewer) {
            $query->whereHas('editions', fn (Builder $editions) => $editions->where('visibility', Visibility::Published))
                ->orWhereHas(
                    'canonicalPassages.transcriptionSegments.transcriptionLayer.transcription',
                    fn (Builder $q) => $q->where('visibility', Visibility::Published),
                );

            if ($viewer !== null) {
                $query->orWhereIn('works.id', Work::query()->editableBy($viewer)->select('works.id'));
            }
        });
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'tokenization' => Tokenization::class,
        ];
    }
}
