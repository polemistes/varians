<?php

namespace App\Support;

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\ManuscriptImage;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\Witness;
use App\Models\Work;

/**
 * Plain counts of what else would be destroyed alongside a Work, Witness,
 * Transcription, or ManuscriptImage — or alongside a set of collation
 * readings whose source text an edit is about to remove (forLostReadings).
 * Entirely derived from the DB's own cascadeOnDelete() foreign keys (see the
 * migrations), not a second source of truth. Used only to build a
 * confirmation warning before something destructive; the deletions themselves
 * never consult this class.
 */
class DeletionImpact
{
    /**
     * A Work's canonical passages cascade to every Edition of the work
     * (destroyed outright, along with that edition's own EditionLemma/
     * EditionPassage/EditionTransposition rows — already implied by
     * 'editions' below, not counted separately), every Lemma/LemmaReading
     * built for those passages, every Conjecture recorded against them, and
     * — the least obvious one — every TranscriptionSegment citing those
     * passages, even on a witness with no other connection to this work.
     *
     * @return array{canonicalPassages: int, editions: int, segments: int, conjectures: int, lemmas: int}
     */
    public static function forWork(Work $work): array
    {
        $passageIds = CanonicalPassage::query()->where('work_id', $work->id)->pluck('id');

        return [
            'canonicalPassages' => $passageIds->count(),
            'editions' => Edition::query()->where('work_id', $work->id)->count(),
            'segments' => TranscriptionSegment::query()->whereIn('canonical_passage_id', $passageIds)->count(),
            'conjectures' => Conjecture::query()->whereIn('canonical_passage_id', $passageIds)->count(),
            'lemmas' => Lemma::query()->whereIn('canonical_passage_id', $passageIds)->count(),
        ];
    }

    /**
     * @return array{transcriptions: int, segments: int, regions: int, images: int, editionSelections: int, editionPassages: int}
     */
    public static function forWitness(Witness $witness): array
    {
        $transcriptionIds = Transcription::query()->where('witness_id', $witness->id)->pluck('id');
        $imageIds = $witness->manuscript?->images()->pluck('id') ?? collect();

        return [
            'transcriptions' => $transcriptionIds->count(),
            'segments' => TranscriptionSegment::query()->whereIn('transcription_id', $transcriptionIds)->count(),
            'regions' => TranscriptionRegion::query()
                ->where(fn ($query) => $query
                    ->whereIn('transcription_id', $transcriptionIds)
                    ->orWhereIn('manuscript_image_id', $imageIds))
                ->count(),
            'images' => $imageIds->count(),
            'editionSelections' => EditionLemma::query()
                ->whereHas('selectedReading', fn ($query) => $query->whereIn('transcription_id', $transcriptionIds))
                ->count(),
            'editionPassages' => EditionPassage::query()->whereIn('transcription_id', $transcriptionIds)->count(),
        ];
    }

    /**
     * @return array{segments: int, regions: int, editionSelections: int, editionPassages: int}
     */
    public static function forTranscription(Transcription $transcription): array
    {
        return [
            'segments' => TranscriptionSegment::query()->where('transcription_id', $transcription->id)->count(),
            'regions' => TranscriptionRegion::query()->where('transcription_id', $transcription->id)->count(),
            'editionSelections' => EditionLemma::query()
                ->whereHas('selectedReading', fn ($query) => $query->where('transcription_id', $transcription->id))
                ->count(),
            'editionPassages' => EditionPassage::query()->where('transcription_id', $transcription->id)->count(),
        ];
    }

    /**
     * What discarding a set of collation readings would cost. Unlike the
     * methods above this is not previewing a delete the user asked for — it
     * previews collateral damage from editing a transcription's *text*, where
     * an edit can remove the very words a reading was collated from (see
     * TranscriptionTextController::update). Counted the same way regardless,
     * since the cascade is the same one: edition_lemmas.selected_reading_id
     * is NOT NULL and cascades, so a discarded reading takes every edition's
     * selection of it with it.
     *
     * @param  list<int>  $readingIds
     * @return array{readings: int, editionSelections: int}
     */
    public static function forLostReadings(array $readingIds): array
    {
        return [
            'readings' => count($readingIds),
            'editionSelections' => EditionLemma::query()->whereIn('selected_reading_id', $readingIds)->count(),
        ];
    }

    /**
     * @return array{features: int, regions: int}
     */
    public static function forManuscriptImage(ManuscriptImage $image): array
    {
        return [
            'features' => $image->features()->count(),
            'regions' => $image->regions()->count(),
        ];
    }
}
