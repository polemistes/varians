<?php

namespace App\Models;

use App\Support\Bibliography\CitationLabel;
use Database\Factories\BibliographyItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One entry of the common bibliography — a biblatex entry, held as biblatex
 * holds it: an entry type (`@article`, `@book`, …), a citation key, and a
 * map of biblatex fields to values in biblatex's own conventions (name
 * lists as "Last, First and Last, First", dates as ISO, page ranges with
 * "--"). Nothing outside the biblatex field list is stored, so the whole
 * list exports to a .bib file that any biblatex user can read back — see
 * App\Support\Bibliography\Biblatex for the registry of types and fields.
 *
 * The list is shared by everything that cites: a conjecture (whatever
 * edition it is read in) and a passage of an edition both point at the same
 * item through BibliographyReference. Editing is collaborative like the
 * rest of the app; `user_id` records who entered the item.
 *
 * `label` is the short author–year form the apparatus prints ("Wilamowitz
 * 1927", "Dover and Henderson 1987b"), derived on save by CitationLabel and
 * stored so the list sorts and searches by it.
 *
 * @property int $id
 * @property string $entry_type
 * @property string $citation_key
 * @property array<string, string> $fields
 * @property string $label
 * @property int|null $user_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['entry_type', 'citation_key', 'fields', 'label', 'user_id'])]
class BibliographyItem extends Model
{
    /** @use HasFactory<BibliographyItemFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<BibliographyReference, $this>
     */
    public function references(): HasMany
    {
        return $this->hasMany(BibliographyReference::class);
    }

    /** One biblatex field's value, or null when the entry does not carry it. */
    public function field(string $name): ?string
    {
        $value = $this->fields[$name] ?? null;

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * Derive the author–year label from the fields as they stand, and make
     * it unique among the items sharing its base ("Henderson 1987",
     * "Henderson 1987a", …) — the suffix is what tells two works of one
     * year apart in the apparatus.
     */
    public function refreshLabel(): void
    {
        $base = CitationLabel::base($this->entry_type, $this->fields);

        $taken = static::query()
            ->whereKeyNot($this->id ?? 0)
            ->where(fn (Builder $query) => $query
                ->where('label', $base)
                ->orWhere('label', 'like', $base.'_'))
            ->pluck('label')
            ->map(fn ($label) => (string) $label)
            ->all();

        $this->label = CitationLabel::disambiguate($base, array_values($taken));
    }

    /**
     * Scope to items matching a free-text search on key, label and the
     * fields that identify a work — for the list's search box and the
     * picker's typeahead.
     *
     * @param  Builder<BibliographyItem>  $query
     */
    #[Scope]
    protected function search(Builder $query, string $term): void
    {
        $term = trim($term);

        if ($term === '') {
            return;
        }

        $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $term).'%';

        $query->where(fn (Builder $inner) => $inner
            ->where('citation_key', 'like', $like)
            ->orWhere('label', 'like', $like)
            ->orWhere('fields', 'like', $like));
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'fields' => 'array',
        ];
    }
}
