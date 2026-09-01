<?php

namespace App\Models;

use Database\Factories\TranscriptionPageBreakFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Where a manuscript page begins in a transcription, as a line number.
 *
 * One division per transcription, not one per layer: a page holds a stretch of
 * the manuscript and both layers transcribe that same stretch, so where it
 * begins is a fact about the transcription rather than about either text.
 *
 * The coordinate is the line because it is the only one the two layers share —
 * their character offsets differ, since the diplomatic layer carries markup
 * the normalized one does not, but a line of the transcription is a line of
 * the manuscript in both. A page begins at the start of a line, a manuscript
 * line not spanning two pages. Each layer converts to its own offsets with
 * `TranscriptionLayer::offsetOfLine()`.
 *
 * A page runs from its own break to the next, so this is a single number: the
 * pages of a transcription cannot then overlap or leave gaps. Lines before the
 * first break are on no page yet.
 *
 * @property int $id
 * @property int $transcription_id
 * @property int $manuscript_page_id
 * @property int $start_line
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['transcription_id', 'manuscript_page_id', 'start_line'])]
class TranscriptionPageBreak extends Model
{
    /** @use HasFactory<TranscriptionPageBreakFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Transcription, $this>
     */
    public function transcription(): BelongsTo
    {
        return $this->belongsTo(Transcription::class);
    }

    /**
     * @return BelongsTo<ManuscriptPage, $this>
     */
    public function manuscriptPage(): BelongsTo
    {
        return $this->belongsTo(ManuscriptPage::class);
    }
}
