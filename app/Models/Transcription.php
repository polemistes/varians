<?php

namespace App\Models;

use App\Enums\Layer;
use App\Enums\Role;
use App\Enums\Visibility;
use Database\Factories\TranscriptionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;

/**
 * One transcription of a witness, consisting of exactly two layers: what the
 * manuscript physically has, and the editor's regularization of it.
 *
 * A witness may be transcribed more than once. Nothing here records what kind
 * of text a transcription holds or which is the principal one — a manuscript
 * may carry texts belonging to different works, or several kinds of text
 * across the same pages, and which transcription matters depends entirely on
 * the edition being made. The editor names them; an edition reaches one
 * through the citation segments on its normalized layer.
 *
 * @property int $id
 * @property int $witness_id
 * @property string $name
 * @property float $position
 * @property Visibility $visibility
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['witness_id', 'name', 'position', 'visibility'])]
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
     * Where each manuscript page begins, in lines. Shared by both layers —
     * see TranscriptionPageBreak.
     *
     * @return HasMany<TranscriptionPageBreak, $this>
     */
    public function pageBreaks(): HasMany
    {
        return $this->hasMany(TranscriptionPageBreak::class);
    }

    /**
     * @return HasMany<TranscriptionLayer, $this>
     */
    public function layers(): HasMany
    {
        return $this->hasMany(TranscriptionLayer::class);
    }

    /**
     * @return HasOne<TranscriptionLayer, $this>
     */
    public function diplomatic(): HasOne
    {
        return $this->hasOne(TranscriptionLayer::class)->where('layer', Layer::Diplomatic);
    }

    /**
     * The layer collation runs on, and the one an edition prints from.
     *
     * @return HasOne<TranscriptionLayer, $this>
     */
    public function normalized(): HasOne
    {
        return $this->hasOne(TranscriptionLayer::class)->where('layer', Layer::Normalized);
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
