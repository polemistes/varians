<?php

namespace App\Models;

use App\Enums\Role;
use App\Enums\Visibility;
use Database\Factories\ManuscriptImageFactory;
use Illuminate\Database\Eloquent\Attributes\Appends;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

/**
 * @property int $id
 * @property int $manuscript_id
 * @property int $manuscript_page_id
 * @property string $path
 * @property string $position
 * @property-read string $url
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['manuscript_id', 'manuscript_page_id', 'path', 'position'])]
#[Appends(['url'])]
class ManuscriptImage extends Model
{
    /** @use HasFactory<ManuscriptImageFactory> */
    use HasFactory;

    /**
     * The page this is a photograph of. The label lives there: a page is
     * named whether or not anyone has photographed it.
     *
     * @return BelongsTo<ManuscriptPage, $this>
     */
    public function manuscriptPage(): BelongsTo
    {
        return $this->belongsTo(ManuscriptPage::class);
    }

    /**
     * @return BelongsTo<Manuscript, $this>
     */
    public function manuscript(): BelongsTo
    {
        return $this->belongsTo(Manuscript::class);
    }

    /**
     * @return HasMany<TranscriptionRegion, $this>
     */
    public function regions(): HasMany
    {
        return $this->hasMany(TranscriptionRegion::class);
    }

    /**
     * @return HasMany<ManuscriptImageFeature, $this>
     */
    public function features(): HasMany
    {
        return $this->hasMany(ManuscriptImageFeature::class);
    }

    /**
     * Scope a query to images visible to the given viewer: editors and
     * administrators see everything; everyone else only sees images with at
     * least one region mapped to a published transcription.
     *
     * @param  Builder<ManuscriptImage>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->whereHas(
            'regions.transcriptionLayer.transcription',
            fn (Builder $q) => $q->where('visibility', Visibility::Published),
        );
    }

    /**
     * @return Attribute<string, never>
     */
    protected function url(): Attribute
    {
        return Attribute::make(
            get: fn (): string => Storage::disk('public')->url($this->path),
        );
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'position' => 'decimal:10',
        ];
    }
}
