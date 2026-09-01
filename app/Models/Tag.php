<?php

namespace App\Models;

use Database\Factories\TagFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Carbon;

/**
 * A free-form, scholar-defined label a transcription can carry — e.g.
 * "diplomatic", "punctuated", "orthographically corrected". The app does not
 * prescribe a fixed vocabulary or a fixed set of normalization levels.
 *
 * @property int $id
 * @property string $name
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name'])]
class Tag extends Model
{
    /** @use HasFactory<TagFactory> */
    use HasFactory;

    /**
     * @return BelongsToMany<TranscriptionLayer, $this>
     */
    public function transcriptions(): BelongsToMany
    {
        return $this->belongsToMany(TranscriptionLayer::class);
    }

    /**
     * Resolve a list of scholar-typed tag names to their ids, creating any
     * that don't exist yet. Blank/duplicate names are dropped.
     *
     * @param  list<string>  $names
     * @return list<int>
     */
    public static function resolveIds(array $names): array
    {
        return array_values(
            collect($names)
                ->map(fn (string $name) => trim($name))
                ->filter()
                ->unique()
                ->map(fn (string $name) => self::firstOrCreate(['name' => $name])->id)
                ->all(),
        );
    }
}
