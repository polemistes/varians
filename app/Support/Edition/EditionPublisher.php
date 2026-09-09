<?php

namespace App\Support\Edition;

use App\Enums\Visibility;
use App\Models\CanonicalPassage;
use App\Models\Edition;
use App\Models\Transcription;
use App\Models\Work;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Publishing an edition publishes the work's evidence with it: every
 * transcription citing one of the work's passages (and so every witness
 * they belong to), and every conjecture recorded against the work. A
 * reader of the edition must be able to follow its apparatus back to what
 * it reports; an apparatus citing manuscripts she may not open is no
 * apparatus.
 *
 * Unpublishing takes them back — unless another published edition of the
 * work, or of another work a transcription also cites, still needs them.
 * Nothing is lost for anyone who copied the edition while it was public:
 * a copy is a whole of its own, witnesses and conjectures included.
 */
class EditionPublisher
{
    /**
     * What a conjecture newly recorded against this passage's work is born
     * with. Where a published edition of the work already stands, a new
     * conjecture is published at once: it can be placed in that edition's
     * apparatus immediately, and a conjecture a reader can see printed
     * must not be simultaneously missing from the work's own list. Where
     * no edition is published, it stays a draft until one is, and
     * publish() below sweeps it up.
     */
    public static function visibilityForConjectureOn(int $canonicalPassageId): Visibility
    {
        $published = CanonicalPassage::query()
            ->whereKey($canonicalPassageId)
            ->whereHas('work.editions', fn (Builder $editions) => $editions->where('visibility', Visibility::Published))
            ->exists();

        return $published ? Visibility::Published : Visibility::Draft;
    }

    public static function publish(Edition $edition): void
    {
        DB::transaction(function () use ($edition) {
            $edition->update(['visibility' => Visibility::Published]);

            self::transcriptionsCiting($edition->work)->update(['visibility' => Visibility::Published->value]);
            $edition->work->conjectures()->update(['conjectures.visibility' => Visibility::Published->value]);
        });
    }

    public static function unpublish(Edition $edition): void
    {
        DB::transaction(function () use ($edition) {
            $edition->update(['visibility' => Visibility::Draft]);

            $work = $edition->work;

            if ($work->editions()->where('visibility', Visibility::Published)->exists()) {
                return;
            }

            $work->conjectures()->update(['conjectures.visibility' => Visibility::Draft->value]);

            // A transcription of a codex holding several works stays public
            // while a published edition of any of the others still cites it.
            self::transcriptionsCiting($work)
                ->whereDoesntHave('layers.segments.canonicalPassage.work', fn (Builder $works) => $works
                    ->whereKeyNot($work->id)
                    ->whereHas('editions', fn (Builder $editions) => $editions->where('visibility', Visibility::Published)))
                ->update(['visibility' => Visibility::Draft->value]);
        });
    }

    /**
     * @return Builder<Transcription>
     */
    private static function transcriptionsCiting(Work $work): Builder
    {
        return Transcription::query()->whereHas(
            'layers.segments.canonicalPassage',
            fn (Builder $passages) => $passages->where('work_id', $work->id),
        );
    }
}
