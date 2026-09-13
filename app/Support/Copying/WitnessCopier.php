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
use App\Models\Work;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Reproduces a witness for another owner: the physical apparatus (pages,
 * photographs, their features), its transcriptions with both layers, the
 * image mappings and page division — and ITS ASSIGNMENTS, always. A copy
 * without them is a wall of text somebody has to assign again line by line;
 * the assignments are the transcription work (user decision).
 *
 * What they point AT depends on whose witness it is:
 *
 * - One the copier may edit — her own, or one whose work she has been given
 *   editing privileges on — keeps its assignments pointing at the very same
 *   passages. Her edits then show up as variants in her own editions of that
 *   work, and in the shared edition she took the witness from, which is the
 *   point of copying a witness one already works on.
 * - Someone else's public witness brings COPIES of the works it assigns text
 *   to, and every assignment is moved onto those. Her copy is then wholly
 *   her own: nothing she does to it reaches the original editor's apparatus,
 *   where she has no business appearing.
 *
 * A caller that has already copied the works says so by passing
 * `$passageMap` (old passage id to new) — EditionCopier does, having copied
 * the work for its own reasons.
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
     * @param  array<int, int>  $passageMap  old canonical passage id → new, where the caller has copied the works itself
     * @param  array<int, mixed>|null  $transcriptionIds  which of the witness's transcriptions to copy — all when null
     * @return array{witness: Witness, layers: array<int, int>, works: array<int, Work>} the copy, old layer id → new, and any works copied along the way by old id
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

        // Where the copier may edit this witness — her own, or one whose
        // work she has been given editing privileges on — the assignments
        // go on naming the passages they named, and what she does to her
        // copy shows up as variants in her own editions of that work and in
        // the shared edition she took it from. Where she may not, the works
        // are copied too and every assignment is moved onto them, so that
        // her edits are hers and reach nobody else's apparatus (user
        // decision; see .ai/rules/access.md).
        $works = [];

        if ($passageMap === [] && ! $owner->can('update', $witness)) {
            [$passageMap, $works] = self::copyCitedWorks($transcriptions, $owner);
        }

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
                    $segmentCopy = $segment->replicate();
                    $segmentCopy->transcription_layer_id = $layerCopy->id;
                    // Remapped where the caller copied the work too, and
                    // otherwise left pointing where it pointed.
                    $segmentCopy->canonical_passage_id = $passageMap[$segment->canonical_passage_id]
                        ?? $segment->canonical_passage_id;
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

        return ['witness' => $copy, 'layers' => $layers, 'works' => $works];
    }

    /**
     * A copy of every work these transcriptions assign text to, with its
     * passages — so the assignments have somewhere of the copier's own to
     * point. Works are taken in title order, so several copies arrive in a
     * predictable one.
     *
     * @param  Collection<int, Transcription>  $transcriptions
     * @return array{0: array<int, int>, 1: array<int, Work>} old passage id → new, and the works copied by old id
     */
    private static function copyCitedWorks(Collection $transcriptions, User $owner): array
    {
        $works = Work::query()
            ->whereHas(
                'canonicalPassages.transcriptionSegments.transcriptionLayer',
                fn (Builder $query) => $query->whereIn('transcription_id', $transcriptions->modelKeys())
            )
            ->orderBy('title')
            ->get();

        $passageMap = [];
        $copies = [];

        foreach ($works as $work) {
            /** @var Work $work */
            ['work' => $copy, 'passages' => $passages] = WorkCopier::copy($work, $owner);
            $passageMap += $passages;
            $copies[$work->id] = $copy;
        }

        return [$passageMap, $copies];
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
