<?php

namespace App\Models;

use App\Enums\Role;
use App\Enums\Visibility;
use Database\Factories\TranscriptionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $witness_id
 * @property int $user_id
 * @property int|null $forked_from_id
 * @property string $text
 * @property Visibility $visibility
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['witness_id', 'user_id', 'forked_from_id', 'text', 'visibility'])]
class Transcription extends Model
{
    /** @use HasFactory<TranscriptionFactory> */
    use HasFactory;

    protected $attributes = [
        'visibility' => Visibility::Draft,
    ];

    /**
     * @return BelongsTo<Witness, $this>
     */
    public function witness(): BelongsTo
    {
        return $this->belongsTo(Witness::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Transcription, $this>
     */
    public function forkedFrom(): BelongsTo
    {
        return $this->belongsTo(Transcription::class, 'forked_from_id');
    }

    /**
     * @return HasMany<Transcription, $this>
     */
    public function forks(): HasMany
    {
        return $this->hasMany(Transcription::class, 'forked_from_id');
    }

    /**
     * @return HasMany<TranscriptionSegment, $this>
     */
    public function segments(): HasMany
    {
        return $this->hasMany(TranscriptionSegment::class);
    }

    /**
     * @return HasMany<TranscriptionRegion, $this>
     */
    public function regions(): HasMany
    {
        return $this->hasMany(TranscriptionRegion::class);
    }

    /**
     * @return BelongsToMany<Tag, $this>
     */
    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class);
    }

    /**
     * Scope a query to transcriptions with at least one segment assigned to the given work.
     *
     * @param  Builder<Transcription>  $query
     */
    #[Scope]
    protected function forWork(Builder $query, Work $work): void
    {
        $query->whereHas(
            'segments.canonicalPassage',
            fn (Builder $q) => $q->where('work_id', $work->id),
        );
    }

    /**
     * Scope a query to transcriptions visible to the given viewer: published
     * ones, plus everything if the viewer is an editor or administrator —
     * editing here is fully collaborative, so there's no per-author split.
     *
     * @param  Builder<Transcription>  $query
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
