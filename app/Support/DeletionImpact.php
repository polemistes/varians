<?php

namespace App\Support;

use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Models\Edition;
use App\Models\EditionLemma;
use App\Models\EditionPassage;
use App\Models\Lemma;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\Witness;
use App\Models\Work;

/**
 * Plain counts of what else would be deleted alongside a Work, Witness,
 * TranscriptionLayer, or ManuscriptImage — entirely derived from the DB's own
 * cascadeOnDelete() foreign keys (see the migrations), not a second source
 * of truth. Used only to build a confirmation warning before a destructive
 * delete; deletion itself never consults this class.
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
     * @return array{transcriptions: int, segments: int, regions: int, images: int, pages: int, editionSelections: int, editionPassages: int}
     */
    public static function forWitness(Witness $witness): array
    {
        $transcriptionIds = $witness->transcriptionLayers()->pluck('transcription_layers.id');
        $imageIds = $witness->manuscript?->images()->pluck('id') ?? collect();

        return [
            'transcriptions' => $transcriptionIds->count(),
            'segments' => TranscriptionSegment::query()->whereIn('transcription_layer_id', $transcriptionIds)->count(),
            'regions' => TranscriptionRegion::query()
                ->where(fn ($query) => $query
                    ->whereIn('transcription_layer_id', $transcriptionIds)
                    ->orWhereIn('manuscript_image_id', $imageIds))
                ->count(),
            'images' => $imageIds->count(),
            'pages' => $witness->manuscript?->pages()->count() ?? 0,
            'editionSelections' => EditionLemma::query()
                ->whereHas('selectedReading', fn ($query) => $query->whereIn('transcription_layer_id', $transcriptionIds))
                ->count(),
            'editionPassages' => EditionPassage::query()->whereIn('transcription_layer_id', $transcriptionIds)->count(),
        ];
    }

    /**
     * @return array{segments: int, regions: int, editionSelections: int, editionPassages: int}
     */
    public static function forTranscription(TranscriptionLayer $transcription): array
    {
        return [
            'segments' => TranscriptionSegment::query()->where('transcription_layer_id', $transcription->id)->count(),
            'regions' => TranscriptionRegion::query()->where('transcription_layer_id', $transcription->id)->count(),
            'editionSelections' => EditionLemma::query()
                ->whereHas('selectedReading', fn ($query) => $query->where('transcription_layer_id', $transcription->id))
                ->count(),
            'editionPassages' => EditionPassage::query()->where('transcription_layer_id', $transcription->id)->count(),
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
