<?php

namespace App\Models;

use App\Enums\Role;
use App\Enums\Visibility;
use Database\Factories\WitnessFactory;
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
 * A physical or textual source (manuscript, printed edition, or apparatus
 * reconstruction). Not scoped to a single work — one manuscript codex can
 * contain several works, and its relation to any given work is derived
 * (see relatedWorks()), not a stored fact of the witness itself.
 *
 * There is deliberately no witness "type": every witness carries the whole
 * physical apparatus — repository, shelfmark, date, pages, photographs —
 * with every field optional, so a collection of readings from the Suda
 * simply leaves the shelfmark empty. The old type column existed only to
 * decide which witnesses got a separate `Manuscript` row; both are gone.
 *
 * Owned by the member who registered it; editable, besides, by whoever may
 * edit a work it is connected to (see WitnessPolicy). Its visibility is
 * that of its transcriptions: a witness is public once one is.
 *
 * @property int $id
 * @property int|null $user_id
 * @property int|null $copied_from_id
 * @property string $siglum
 * @property string|null $label
 * @property string|null $repository
 * @property string|null $shelfmark
 * @property string|null $date_text
 * @property string|null $description
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['user_id', 'copied_from_id', 'siglum', 'label', 'repository', 'shelfmark', 'date_text', 'description'])]
class Witness extends Model
{
    /** @use HasFactory<WitnessFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The witness this one was copied from, when it is a copy — see
     * App\Support\Copying\EditionCopier.
     *
     * @return BelongsTo<Witness, $this>
     */
    public function copiedFrom(): BelongsTo
    {
        return $this->belongsTo(Witness::class, 'copied_from_id');
    }

    /**
     * Works connected to this witness — derived, not stored: a work is
     * related to a witness only once one of the witness's transcriptions has
     * a segment citing one of that work's canonical passages.
     *
     * @return Builder<Work>
     */
    public function relatedWorks(): Builder
    {
        return Work::query()->whereHas(
            'canonicalPassages.transcriptionSegments.transcriptionLayer.transcription',
            fn (Builder $query) => $query->where('witness_id', $this->id),
        );
    }

    /**
     * @return HasMany<ManuscriptPage, $this>
     */
    public function pages(): HasMany
    {
        return $this->hasMany(ManuscriptPage::class);
    }

    /**
     * @return HasMany<ManuscriptImage, $this>
     */
    public function images(): HasMany
    {
        return $this->hasMany(ManuscriptImage::class);
    }

    /**
     * @return HasMany<Transcription, $this>
     */
    public function transcriptions(): HasMany
    {
        return $this->hasMany(Transcription::class);
    }

    /**
     * Every layer of every transcription of this witness.
     *
     * @return HasManyThrough<TranscriptionLayer, Transcription, $this>
     */
    public function transcriptionLayers(): HasManyThrough
    {
        return $this->hasManyThrough(TranscriptionLayer::class, Transcription::class);
    }

    /**
     * Whether this member may edit the witness: its owner, or anyone who
     * may edit a work one of its transcriptions cites. Site-wide roles are
     * the policies' business, not this one's.
     */
    public function isEditableBy(User $user): bool
    {
        return $this->user_id === $user->id
            || $this->relatedWorks()->editableBy($user)->exists();
    }

    /**
     * Whether an edition belonging to someone else prints text from this
     * witness — as a passage's base, or as a reading that edition has
     * chosen. Deleting the witness cascades both away, so its owner is
     * refused while that stands (an administrator is not: see
     * WitnessPolicy::delete). The same question, asked of one transcript,
     * guards TranscriptionController::destroy.
     *
     * @param  array<int, int>|null  $layerIds  the layers to ask about; all of the witness's when null
     */
    public function isPrintedByAnothersEdition(User $owner, ?array $layerIds = null): bool
    {
        $layerIds ??= $this->transcriptionLayers()->pluck('transcription_layers.id')->all();

        if ($layerIds === []) {
            return false;
        }

        $elsewhere = fn (Builder $editions) => $editions->where('editions.user_id', '!=', $owner->id);

        return EditionPassage::query()
            ->whereIn('transcription_layer_id', $layerIds)
            ->whereHas('edition', $elsewhere)
            ->exists()
            || EditionLemma::query()
                ->whereHas('selectedReading', fn (Builder $readings) => $readings->whereIn('transcription_layer_id', $layerIds))
                ->whereHas('edition', $elsewhere)
                ->exists();
    }

    /**
     * Whether readers at large may see the witness: one of its
     * transcriptions is published.
     */
    public function isPublished(): bool
    {
        return $this->transcriptions()->where('visibility', Visibility::Published)->exists();
    }

    /**
     * Scope a query to witnesses the given member may edit — the SQL form
     * of isEditableBy(), for lists.
     *
     * @param  Builder<Witness>  $query
     */
    #[Scope]
    protected function editableBy(Builder $query, User $user): void
    {
        $query->where(function (Builder $query) use ($user) {
            $query->where('witnesses.user_id', $user->id)
                ->orWhereHas(
                    'transcriptionLayers.segments.canonicalPassage',
                    fn (Builder $passages) => $passages->whereIn('work_id', Work::query()->editableBy($user)->select('works.id')),
                );
        });
    }

    /**
     * Scope a query to witnesses visible to the given viewer: editors and
     * administrators see everything; a member also sees what she may edit;
     * everyone sees a witness with at least one published transcription —
     * symmetric with Work::visibleTo().
     *
     * @param  Builder<Witness>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->where(function (Builder $query) use ($viewer) {
            $query->whereHas(
                'transcriptions',
                fn (Builder $q) => $q->where('visibility', Visibility::Published),
            );

            if ($viewer !== null) {
                $query->orWhereIn('witnesses.id', Witness::query()->editableBy($viewer)->select('witnesses.id'));
            }
        });
    }
}
