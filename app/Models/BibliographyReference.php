<?php

namespace App\Models;

use Database\Factories\BibliographyReferenceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One citation of a BibliographyItem by exactly one of two things: a
 * Conjecture, or a passage of one Edition (keyed by edition and canonical
 * passage, like EditionComment — never through EditionPassage, so that
 * removing and re-adding a passage does not destroy its literature).
 *
 * `prenote` and `postnote` are biblatex's `\cite[pre][post]{key}`: "cf."
 * before, and the locator after — "pp. 45–47", "ad loc.", "n. 3". Free
 * text, since where in a work the point is made is editorial judgment.
 * `position` orders the citations of one citing thing.
 *
 * A conjecture's references are edition-independent, like the conjecture
 * itself; a passage's belong to the one edition that made them.
 *
 * @property int $id
 * @property int $bibliography_item_id
 * @property int|null $conjecture_id
 * @property int|null $edition_id
 * @property int|null $canonical_passage_id
 * @property string|null $prenote
 * @property string|null $postnote
 * @property int $position
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['bibliography_item_id', 'conjecture_id', 'edition_id', 'canonical_passage_id', 'prenote', 'postnote', 'position'])]
class BibliographyReference extends Model
{
    /** @use HasFactory<BibliographyReferenceFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<BibliographyItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(BibliographyItem::class, 'bibliography_item_id');
    }

    /**
     * @return BelongsTo<Conjecture, $this>
     */
    public function conjecture(): BelongsTo
    {
        return $this->belongsTo(Conjecture::class);
    }

    /**
     * @return BelongsTo<Edition, $this>
     */
    public function edition(): BelongsTo
    {
        return $this->belongsTo(Edition::class);
    }

    /**
     * @return BelongsTo<CanonicalPassage, $this>
     */
    public function canonicalPassage(): BelongsTo
    {
        return $this->belongsTo(CanonicalPassage::class);
    }

    /**
     * The citation as the apparatus prints it: "cf. Wilamowitz 1927, 45".
     */
    public function citation(): string
    {
        $parts = array_filter([
            $this->prenote,
            $this->item->label.($this->postnote !== null && $this->postnote !== '' ? ', '.$this->postnote : ''),
        ], fn (?string $part) => $part !== null && $part !== '');

        return implode(' ', $parts);
    }
}
