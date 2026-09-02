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
 * @property int $id
 * @property string $siglum
 * @property string|null $label
 * @property string|null $repository
 * @property string|null $shelfmark
 * @property string|null $date_text
 * @property string|null $description
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['siglum', 'label', 'repository', 'shelfmark', 'date_text', 'description'])]
class Witness extends Model
{
    /** @use HasFactory<WitnessFactory> */
    use HasFactory;

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
     * Scope a query to witnesses visible to the given viewer: editors and
     * administrators see everything; everyone else only sees witnesses with
     * at least one published transcription — symmetric with Work::visibleTo().
     *
     * @param  Builder<Witness>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->whereHas(
            'transcriptions',
            fn (Builder $q) => $q->where('visibility', Visibility::Published),
        );
    }
}
