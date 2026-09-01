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
 * @property int $id
 * @property int $reference_scheme_id
 * @property string $title
 * @property string|null $author
 * @property string $language
 * @property Tokenization $tokenization
 * @property string $slug
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['reference_scheme_id', 'title', 'author', 'language', 'tokenization', 'slug'])]
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
     * Scope a query to works visible to the given viewer: editors and
     * administrators see everything; everyone else only sees works with at
     * least one published transcription citing one of their passages.
     *
     * @param  Builder<Work>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->whereHas(
            'canonicalPassages.transcriptionSegments.transcriptionLayer.transcription',
            fn (Builder $q) => $q->where('visibility', Visibility::Published),
        );
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
