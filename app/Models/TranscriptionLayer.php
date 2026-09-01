<?php

namespace App\Models;

use App\Enums\Layer;
use App\Enums\Role;
use App\Enums\Visibility;
use Database\Factories\TranscriptionLayerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOneThrough;
use Illuminate\Support\Carbon;

/**
 * One layer — diplomatic or normalized — of a witness's transcription. It
 * owns the continuous `text` and everything that carries character offsets
 * into it: citation segments, image-alignment regions and collation readings.
 *
 * Visibility is not here: a transcription is public or it is not, and if it
 * is, both of its layers are. Which layer an editor writes first is how she
 * chooses to work, not a claim that the other is more provisional.
 *
 * @property int $id
 * @property int $transcription_id
 * @property int $user_id
 * @property int|null $copied_from_id
 * @property Layer $layer
 * @property string $text
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['transcription_id', 'user_id', 'copied_from_id', 'layer', 'text'])]
class TranscriptionLayer extends Model
{
    /** @use HasFactory<TranscriptionLayerFactory> */
    use HasFactory;

    protected $attributes = [
        'layer' => Layer::Normalized,
    ];

    /**
     * @return BelongsTo<Transcription, $this>
     */
    public function transcription(): BelongsTo
    {
        return $this->belongsTo(Transcription::class);
    }

    /**
     * The witness this layer transcribes, through its parent transcription.
     *
     * @return HasOneThrough<Witness, Transcription, $this>
     */
    public function witness(): HasOneThrough
    {
        return $this->hasOneThrough(
            Witness::class,
            Transcription::class,
            'id',
            'id',
            'transcription_id',
            'witness_id',
        );
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<TranscriptionLayer, $this>
     */
    public function copiedFrom(): BelongsTo
    {
        return $this->belongsTo(TranscriptionLayer::class, 'copied_from_id');
    }

    /**
     * @return HasMany<TranscriptionLayer, $this>
     */
    public function copies(): HasMany
    {
        return $this->hasMany(TranscriptionLayer::class, 'copied_from_id');
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
     * The character offset at which the given line begins in this text.
     *
     * Page divisions are held as line numbers on the transcription, because
     * that is the coordinate both layers share; each layer resolves them
     * against its own text here. A line past the end clamps to the end, which
     * is what a page not yet transcribed looks like.
     */
    public function offsetOfLine(int $line): int
    {
        if ($line <= 0) {
            return 0;
        }

        $offset = 0;
        $lines = explode("\n", $this->text);

        for ($index = 0; $index < $line; $index++) {
            if (! isset($lines[$index])) {
                return mb_strlen($this->text);
            }

            $offset += mb_strlen($lines[$index]) + 1;
        }

        return min($offset, mb_strlen($this->text));
    }

    /** The line the given character offset falls on. */
    public function lineOfOffset(int $offset): int
    {
        return mb_substr_count(mb_substr($this->text, 0, max(0, $offset)), "\n");
    }

    /**
     * Collation readings sourced from this transcription's text. Like
     * segments and regions these carry character offsets into `text`, so they
     * must be transformed whenever it is edited — see
     * TranscriptionTextController. Conjecture-sourced readings have a null
     * `transcription_id` and no offsets, and are not part of this relation.
     *
     * @return HasMany<LemmaReading, $this>
     */
    public function lemmaReadings(): HasMany
    {
        return $this->hasMany(LemmaReading::class);
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
     * @param  Builder<TranscriptionLayer>  $query
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
     * @param  Builder<TranscriptionLayer>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, ?User $viewer): void
    {
        if ($viewer !== null && $viewer->hasRole(Role::Editor)) {
            return;
        }

        $query->whereHas('transcription', fn (Builder $parent) => $parent->where('visibility', Visibility::Published));
    }

    /**
     * Scope a query to the layer collation runs on. See Layer
     * for why a diplomatic transcription must never enter the apparatus: it
     * would make a manuscript appear as its own variant, disagreeing with
     * itself over the orthography the normalized layer regularized.
     *
     * @param  Builder<TranscriptionLayer>  $query
     */
    #[Scope]
    protected function collatable(Builder $query): void
    {
        $query->where('layer', Layer::Normalized);
    }

    /**
     * Which layer of `$target` a copy of this one fills.
     *
     * The destination transcription is the only choice an editor makes:
     * inside her own transcription there is just the other layer, and any
     * other transcription receives the copy into its corresponding layer.
     * Copying a diplomatic text into some other manuscript's normalized layer
     * is not a thing an editor means.
     */
    public function destinationLayerIn(Transcription $target): Layer
    {
        if (! $target->is($this->transcription)) {
            return $this->layer;
        }

        return $this->layer === Layer::Diplomatic ? Layer::Normalized : Layer::Diplomatic;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'layer' => Layer::class,
        ];
    }
}
