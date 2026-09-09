<?php

namespace App\Support\Copying;

use App\Enums\Visibility;
use App\Models\BibliographyReference;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\ConjectureOrderingEntry;
use App\Models\Edition;
use App\Models\EditionComment;
use App\Models\EditionLemma;
use App\Models\EditionLineBreak;
use App\Models\EditionPassage;
use App\Models\EditionTransposition;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Models\User;
use App\Models\Witness;
use App\Models\Work;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Gives a member a public edition of her own: not the edition alone but
 * the whole of what it stands on — a copy of the work with its passages,
 * of every witness citing the work (their transcriptions, restricted to
 * what cites it), of the collation built on them, and of every conjecture
 * recorded against the work — so that editing the copy can never touch
 * the original. Lemma columns are shared by every edition of a WORK
 * (see Lemma), which is why a copy has to be a work of its own.
 *
 * What stays shared: the reference scheme (a numbering, not evidence) and
 * the bibliography (a common list; citations are copied, items are not).
 * The copy is a draft, has no invited editors, and records where it came
 * from in `copied_from_id` throughout.
 */
class EditionCopier
{
    public static function copy(Edition $edition, User $owner): Edition
    {
        return DB::transaction(function () use ($edition, $owner): Edition {
            $work = $edition->work;
            $workCopy = self::copyWork($work, $owner);

            $passages = self::copyPassages($work, $workCopy);
            $layers = self::copyWitnesses($work, $owner, $passages);
            $conjectures = self::copyConjectures($work, $owner, $passages);
            [$lemmas, $readings] = self::copyCollation($work, $passages, $layers, $conjectures);

            return self::copyEdition($edition, $owner, $workCopy, $passages, $layers, $conjectures, $lemmas, $readings);
        });
    }

    private static function copyWork(Work $work, User $owner): Work
    {
        $copy = $work->replicate(['user_id', 'copied_from_id', 'slug']);
        $copy->user_id = $owner->id;
        $copy->copied_from_id = $work->id;
        $copy->slug = self::freshSlug($work->slug);
        $copy->save();

        return $copy;
    }

    /**
     * @return array<int, int> old passage id → new
     */
    private static function copyPassages(Work $work, Work $workCopy): array
    {
        $map = [];

        foreach ($work->canonicalPassages()->orderBy('sort_key')->get() as $passage) {
            /** @var CanonicalPassage $passage */
            $copy = $passage->replicate();
            $copy->work_id = $workCopy->id;
            $copy->save();
            $map[$passage->id] = $copy->id;
        }

        return $map;
    }

    /**
     * Every witness citing the work, with only the transcriptions that
     * cite it — a codex's other texts belong to other works.
     *
     * @param  array<int, int>  $passages
     * @return array<int, int> old layer id → new
     */
    private static function copyWitnesses(Work $work, User $owner, array $passages): array
    {
        $layers = [];

        foreach ($work->relatedWitnesses()->orderBy('siglum')->get() as $witness) {
            /** @var Witness $witness */
            $transcriptionIds = Transcription::query()
                ->where('witness_id', $witness->id)
                ->visibleTo($owner)
                ->whereHas('layers.segments.canonicalPassage', fn (Builder $query) => $query->where('work_id', $work->id))
                ->pluck('id')
                ->all();

            // A witness whose transcriptions of this work the copier may
            // not read has nothing to give her: copying it anyway would
            // leave a siglum with pages and photographs and no text.
            if ($transcriptionIds === []) {
                continue;
            }

            $copied = WitnessCopier::copy($witness, $owner, $passages, $transcriptionIds);
            $layers += $copied['layers'];
        }

        return $layers;
    }

    /**
     * Conjectures first without their self-references, then the
     * supplements wired to their lacunae once every id is known.
     *
     * @param  array<int, int>  $passages
     * @return array<int, int> old conjecture id → new
     */
    private static function copyConjectures(Work $work, User $owner, array $passages): array
    {
        $originals = Conjecture::query()
            ->whereIn('canonical_passage_id', array_keys($passages))
            ->visibleTo($owner)
            ->with(['orderingEntries', 'references'])
            ->orderBy('id')
            ->get();
        $map = [];

        foreach ($originals as $conjecture) {
            /** @var Conjecture $conjecture */
            $copy = $conjecture->replicate(['user_id', 'copied_from_id', 'visibility', 'supplements_conjecture_id']);
            // $originals eager-loads 'orderingEntries' and 'references' —
            // replicate() would otherwise carry those stale, old-id-bearing
            // collections onto $copy (see the note on $copy->setRelation
            // ('work', ...) below in copyEdition() for the general shape of
            // this trap).
            $copy->setRelations([]);
            $copy->user_id = $owner->id;
            $copy->copied_from_id = $conjecture->id;
            $copy->visibility = Visibility::Draft;
            $copy->canonical_passage_id = $passages[$conjecture->canonical_passage_id];
            $copy->transposition_range_end_canonical_passage_id = self::mapped($passages, $conjecture->transposition_range_end_canonical_passage_id);
            $copy->move_target_canonical_passage_id = self::mapped($passages, $conjecture->move_target_canonical_passage_id);
            $copy->save();
            $map[$conjecture->id] = $copy->id;

            foreach ($conjecture->orderingEntries as $entry) {
                /** @var ConjectureOrderingEntry $entry */
                if (! isset($passages[$entry->canonical_passage_id])) {
                    continue;
                }

                $entryCopy = $entry->replicate();
                $entryCopy->conjecture_id = $copy->id;
                $entryCopy->canonical_passage_id = $passages[$entry->canonical_passage_id];
                $entryCopy->save();
            }

            foreach ($conjecture->references as $reference) {
                /** @var BibliographyReference $reference */
                $referenceCopy = $reference->replicate();
                $referenceCopy->conjecture_id = $copy->id;
                $referenceCopy->save();
            }
        }

        foreach ($originals as $conjecture) {
            if ($conjecture->supplements_conjecture_id !== null && isset($map[$conjecture->supplements_conjecture_id])) {
                Conjecture::query()->whereKey($map[$conjecture->id])
                    ->update(['supplements_conjecture_id' => $map[$conjecture->supplements_conjecture_id]]);
            }
        }

        return $map;
    }

    /**
     * The columns and their candidate readings. A reading is skipped when
     * what it reads from was not copied — a layer of a transcription that
     * does not cite this work cannot have one, so that is a safety net,
     * not an expected path.
     *
     * @param  array<int, int>  $passages
     * @param  array<int, int>  $layers
     * @param  array<int, int>  $conjectures
     * @return array{0: array<int, int>, 1: array<int, int>} old lemma id → new, old reading id → new
     */
    private static function copyCollation(Work $work, array $passages, array $layers, array $conjectures): array
    {
        $lemmas = [];
        $originals = Lemma::query()->whereIn('canonical_passage_id', array_keys($passages))->orderBy('id')->get();

        foreach ($originals as $lemma) {
            /** @var Lemma $lemma */
            $copy = $lemma->replicate();
            $copy->canonical_passage_id = $passages[$lemma->canonical_passage_id];
            $copy->save();
            $lemmas[$lemma->id] = $copy->id;
        }

        $readings = [];

        foreach (LemmaReading::query()->whereIn('lemma_id', array_keys($lemmas))->orderBy('id')->get() as $reading) {
            /** @var LemmaReading $reading */
            if ($reading->transcription_layer_id !== null && ! isset($layers[$reading->transcription_layer_id])) {
                continue;
            }

            if ($reading->conjecture_id !== null && ! isset($conjectures[$reading->conjecture_id])) {
                continue;
            }

            $copy = $reading->replicate();
            $copy->lemma_id = $lemmas[$reading->lemma_id];
            $copy->range_end_lemma_id = self::mapped($lemmas, $reading->range_end_lemma_id);
            $copy->transcription_layer_id = self::mapped($layers, $reading->transcription_layer_id);
            $copy->conjecture_id = self::mapped($conjectures, $reading->conjecture_id);
            $copy->save();
            $readings[$reading->id] = $copy->id;
        }

        return [$lemmas, $readings];
    }

    /**
     * @param  array<int, int>  $passages
     * @param  array<int, int>  $layers
     * @param  array<int, int>  $conjectures
     * @param  array<int, int>  $lemmas
     * @param  array<int, int>  $readings
     */
    private static function copyEdition(Edition $edition, User $owner, Work $workCopy, array $passages, array $layers, array $conjectures, array $lemmas, array $readings): Edition
    {
        $copy = $edition->replicate(['user_id', 'copied_from_id', 'visibility']);
        $copy->work_id = $workCopy->id;
        $copy->user_id = $owner->id;
        $copy->copied_from_id = $edition->id;
        $copy->visibility = Visibility::Draft;
        // replicate() carries over $edition's already-loaded relations —
        // including 'work', loaded at the top of copy() — so without this,
        // $copy->work still resolves to the ORIGINAL work even though
        // work_id above points at the new one. That mismatch sent the
        // post-copy redirect to the original work's slug with the copy's
        // edition id, which EditionController::show's abort_unless(
        // $work->is($edition->work)) correctly 404s (real incident).
        $copy->setRelation('work', $workCopy);
        $copy->save();

        foreach ($edition->passages()->orderBy('position')->get() as $passage) {
            /** @var EditionPassage $passage */
            if (! isset($passages[$passage->canonical_passage_id])) {
                continue;
            }

            $passageCopy = $passage->replicate();
            $passageCopy->edition_id = $copy->id;
            $passageCopy->canonical_passage_id = $passages[$passage->canonical_passage_id];
            $passageCopy->transcription_layer_id = self::mapped($layers, $passage->transcription_layer_id);
            $passageCopy->save();
        }

        foreach ($edition->selections as $selection) {
            /** @var EditionLemma $selection */
            if (! isset($lemmas[$selection->lemma_id], $readings[$selection->selected_reading_id])) {
                continue;
            }

            $selectionCopy = $selection->replicate();
            $selectionCopy->edition_id = $copy->id;
            $selectionCopy->lemma_id = $lemmas[$selection->lemma_id];
            $selectionCopy->selected_reading_id = $readings[$selection->selected_reading_id];
            $selectionCopy->save();
        }

        foreach (EditionLineBreak::query()->where('edition_id', $edition->id)->get() as $break) {
            /** @var EditionLineBreak $break */
            if (! isset($lemmas[$break->lemma_id])) {
                continue;
            }

            $breakCopy = $break->replicate();
            $breakCopy->edition_id = $copy->id;
            $breakCopy->canonical_passage_id = $passages[$break->canonical_passage_id];
            $breakCopy->lemma_id = $lemmas[$break->lemma_id];
            $breakCopy->save();
        }

        foreach ($edition->comments as $comment) {
            /** @var EditionComment $comment */
            if (! isset($passages[$comment->canonical_passage_id])) {
                continue;
            }

            $commentCopy = $comment->replicate();
            $commentCopy->edition_id = $copy->id;
            $commentCopy->canonical_passage_id = $passages[$comment->canonical_passage_id];
            $commentCopy->lemma_id = self::mapped($lemmas, $comment->lemma_id);
            $commentCopy->range_end_lemma_id = self::mapped($lemmas, $comment->range_end_lemma_id);
            $commentCopy->save();
        }

        foreach ($edition->transpositions as $transposition) {
            /** @var EditionTransposition $transposition */
            if (! isset($conjectures[$transposition->conjecture_id])) {
                continue;
            }

            $transpositionCopy = $transposition->replicate();
            $transpositionCopy->edition_id = $copy->id;
            $transpositionCopy->conjecture_id = $conjectures[$transposition->conjecture_id];
            $transpositionCopy->save();
        }

        foreach (BibliographyReference::query()->where('edition_id', $edition->id)->orderBy('position')->get() as $reference) {
            /** @var BibliographyReference $reference */
            if ($reference->canonical_passage_id !== null && ! isset($passages[$reference->canonical_passage_id])) {
                continue;
            }

            $referenceCopy = $reference->replicate();
            $referenceCopy->edition_id = $copy->id;
            $referenceCopy->canonical_passage_id = self::mapped($passages, $reference->canonical_passage_id);
            $referenceCopy->save();
        }

        return $copy;
    }

    /**
     * @param  array<int, int>  $map
     */
    private static function mapped(array $map, ?int $id): ?int
    {
        return $id === null ? null : ($map[$id] ?? null);
    }

    /**
     * "iliad" copies to "iliad-copy", then "iliad-copy-2", and so on.
     */
    private static function freshSlug(string $slug): string
    {
        $base = $slug.'-copy';
        $candidate = $base;

        for ($n = 2; Work::query()->where('slug', $candidate)->exists(); $n++) {
            $candidate = $base.'-'.$n;
        }

        return $candidate;
    }
}
