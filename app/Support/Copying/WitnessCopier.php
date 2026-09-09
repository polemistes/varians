<?php

namespace App\Support\Copying;

use App\Enums\Visibility;
use App\Models\ManuscriptImage;
use App\Models\ManuscriptImageFeature;
use App\Models\ManuscriptPage;
use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Models\User;
use App\Models\Witness;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Reproduces a witness for another owner: the physical apparatus (pages,
 * photographs, their features), its transcriptions with both layers, the
 * image mappings and page division — and its citations only where the
 * caller can say which passages they now point at (`$passageMap`, old id
 * to new). A witness copied on its own therefore arrives uncited: its
 * citations belonged to a work the copier does not own, and citing into a
 * work is editing it.
 *
 * Only what the copier may see is copied: her own copy must not be a way
 * of reading a draft transcription, or an unmapped photograph, that its
 * owner has not published. Rows pointing at something not copied are
 * skipped rather than tripped over.
 *
 * Photographs are duplicated on disk, so the two witnesses share nothing
 * that deleting one could take from the other.
 */
class WitnessCopier
{
    /**
     * @param  array<int, int>  $passageMap  old canonical passage id → new
     * @param  array<int, mixed>|null  $transcriptionIds  which of the witness's transcriptions to copy — all when null
     * @return array{witness: Witness, layers: array<int, int>} the copy, and old layer id → new
     */
    public static function copy(Witness $witness, User $owner, array $passageMap = [], ?array $transcriptionIds = null): array
    {
        $copy = $witness->replicate(['user_id', 'copied_from_id']);
        $copy->user_id = $owner->id;
        $copy->copied_from_id = $witness->id;
        $copy->save();

        $pages = [];

        foreach ($witness->pages()->orderBy('position')->get() as $page) {
            /** @var ManuscriptPage $page */
            $pageCopy = $page->replicate();
            $pageCopy->witness_id = $copy->id;
            $pageCopy->save();
            $pages[$page->id] = $pageCopy->id;
        }

        $images = [];

        foreach ($witness->images()->visibleTo($owner)->orderBy('position')->get() as $image) {
            /** @var ManuscriptImage $image */
            if (! isset($pages[$image->manuscript_page_id])) {
                continue;
            }

            $imageCopy = $image->replicate();
            $imageCopy->witness_id = $copy->id;
            $imageCopy->manuscript_page_id = $pages[$image->manuscript_page_id];
            $imageCopy->path = self::duplicateFile($image->path);
            $imageCopy->save();
            $images[$image->id] = $imageCopy->id;

            foreach ($image->features as $feature) {
                /** @var ManuscriptImageFeature $feature */
                $featureCopy = $feature->replicate();
                $featureCopy->manuscript_image_id = $imageCopy->id;
                $featureCopy->save();
            }
        }

        $layers = [];
        $groups = [];
        $transcriptions = $witness->transcriptions()->visibleTo($owner)->orderBy('position')
            ->when($transcriptionIds !== null, fn (Builder $query) => $query->whereKey($transcriptionIds))
            ->get();

        foreach ($transcriptions as $transcription) {
            /** @var Transcription $transcription */
            $transcriptionCopy = $transcription->replicate(['visibility']);
            $transcriptionCopy->witness_id = $copy->id;
            $transcriptionCopy->visibility = Visibility::Draft;
            $transcriptionCopy->save();

            foreach ($transcription->pageBreaks as $pageBreak) {
                /** @var TranscriptionPageBreak $pageBreak */
                if (! isset($pages[$pageBreak->manuscript_page_id])) {
                    continue;
                }

                $breakCopy = $pageBreak->replicate();
                $breakCopy->transcription_id = $transcriptionCopy->id;
                $breakCopy->manuscript_page_id = $pages[$pageBreak->manuscript_page_id];
                $breakCopy->save();
            }

            foreach ($transcription->layers as $layer) {
                /** @var TranscriptionLayer $layer */
                $layerCopy = $layer->replicate(['user_id', 'copied_from_id']);
                $layerCopy->transcription_id = $transcriptionCopy->id;
                $layerCopy->user_id = $owner->id;
                $layerCopy->copied_from_id = $layer->id;
                $layerCopy->save();
                $layers[$layer->id] = $layerCopy->id;

                foreach ($layer->segments as $segment) {
                    /** @var TranscriptionSegment $segment */
                    if (! isset($passageMap[$segment->canonical_passage_id])) {
                        continue;
                    }

                    $segmentCopy = $segment->replicate();
                    $segmentCopy->transcription_layer_id = $layerCopy->id;
                    $segmentCopy->canonical_passage_id = $passageMap[$segment->canonical_passage_id];
                    $segmentCopy->group_id = self::regroup($groups, $segment->group_id);
                    $segmentCopy->save();
                }

                foreach ($layer->regions as $region) {
                    /** @var TranscriptionRegion $region */
                    if (! isset($images[$region->manuscript_image_id])) {
                        continue;
                    }

                    $regionCopy = $region->replicate();
                    $regionCopy->transcription_layer_id = $layerCopy->id;
                    $regionCopy->manuscript_image_id = $images[$region->manuscript_image_id];
                    $regionCopy->group_id = self::regroup($groups, $region->group_id);
                    $regionCopy->save();
                }
            }
        }

        return ['witness' => $copy, 'layers' => $layers];
    }

    /**
     * Counterpart rows share a group; the copies share a fresh one, so
     * neither witness's sibling sync can find the other's rows.
     *
     * @param  array<string, string>  $groups
     */
    private static function regroup(array &$groups, ?string $group): ?string
    {
        if ($group === null) {
            return null;
        }

        return $groups[$group] ??= (string) Str::uuid();
    }

    /**
     * A copy of the photograph under a fresh name — or the same path when
     * the file is not there to copy (seeded placeholders, a lost upload),
     * so the copy at least points where the original does.
     */
    private static function duplicateFile(string $path): string
    {
        $disk = Storage::disk('public');

        if (! $disk->exists($path)) {
            return $path;
        }

        $extension = pathinfo($path, PATHINFO_EXTENSION);
        $target = 'manuscript-images/'.Str::uuid().($extension !== '' ? '.'.$extension : '');
        $disk->copy($path, $target);

        return $target;
    }
}
