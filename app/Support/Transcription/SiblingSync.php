<?php

namespace App\Support\Transcription;

use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use Illuminate\Support\Str;

/**
 * One span, two sides: an assignment or facsimile mapping is DONE ONCE and
 * appears in both layers as counterpart rows sharing a `group_id`. Each
 * row keeps transforming with its OWN layer's edits (unambiguous even
 * while the layers are out of step); mutations reach the counterpart by
 * the link; and `heal()` fills a missing side by word projection whenever
 * the layers are in step — so a span made during divergence self-repairs.
 *
 * Rows deliberately stay per-layer rather than sharing one word-coordinate
 * store: a shared store cannot tell a catch-up edit from a leading one
 * while the layers diverge, and would double-move spans on resync.
 */
class SiblingSync
{
    /** The sibling layer that can safely receive the same span, or null. */
    public static function inStepSibling(TranscriptionLayer $layer): ?TranscriptionLayer
    {
        $sibling = $layer->transcription->layers()
            ->whereKeyNot($layer->id)
            ->first();

        if ($sibling === null) {
            return null;
        }

        return LayerCorrespondence::divergence($layer->text, $sibling->text) === null
            ? $sibling
            : null;
    }

    /**
     * The sibling's character range for the same WORDS — for citation
     * segments, which are word-granular.
     *
     * @return array{0: int, 1: int}
     */
    public static function projectRange(TranscriptionLayer $from, TranscriptionLayer $to, int $start, int $end): array
    {
        [$fromWord, $toWord] = WordSpans::toWordRange($from->text, $start, $end);

        return WordSpans::toCharRange($to->text, $fromWord, $toWord);
    }

    /**
     * The sibling's character range through sub-word ANCHORS — for
     * facsimile mappings, which may cover single characters. Exact where
     * the spellings match, clamped where they differ.
     *
     * @return array{0: int, 1: int}
     */
    public static function projectAnchors(TranscriptionLayer $from, TranscriptionLayer $to, int $start, int $end): array
    {
        $startAnchor = WordSpans::startAnchor($from->text, $start);
        $endAnchor = WordSpans::endAnchor($from->text, $end);

        return [
            WordSpans::fromAnchor($to->text, $startAnchor['word'], $startAnchor['char']),
            WordSpans::fromAnchor($to->text, $endAnchor['word'], $endAnchor['char']),
        ];
    }

    /** The counterpart row on the other layer, by the shared group. */
    public static function counterpartSegment(TranscriptionSegment $segment): ?TranscriptionSegment
    {
        return TranscriptionSegment::query()
            ->where('group_id', $segment->group_id)
            ->whereKeyNot($segment->id)
            ->first();
    }

    /** The counterpart row on the other layer, by the shared group. */
    public static function counterpartRegion(TranscriptionRegion $region): ?TranscriptionRegion
    {
        return TranscriptionRegion::query()
            ->where('group_id', $region->group_id)
            ->whereKeyNot($region->id)
            ->first();
    }

    /**
     * Give every one-sided span its counterpart, now that the layers are in
     * step: an existing unlinked row over the same words is LINKED (two
     * halves that never met), anything else is CREATED by projection. Runs
     * after saves; a span assigned while the layers were apart heals here.
     */
    public static function heal(TranscriptionLayer $layer): void
    {
        $sibling = self::inStepSibling($layer);

        if ($sibling === null) {
            return;
        }

        foreach ([$layer, $sibling] as $side) {
            $other = $side->is($layer) ? $sibling : $layer;
            self::healSegments($side, $other);
            self::healRegions($side, $other);
        }
    }

    private static function healSegments(TranscriptionLayer $from, TranscriptionLayer $to): void
    {
        $toSegments = $to->segments()->get();

        foreach ($from->segments()->get() as $segment) {
            if ($segment->group_id !== null
                && TranscriptionSegment::query()->where('group_id', $segment->group_id)->whereKeyNot($segment->id)->exists()) {
                continue;
            }

            // Tombstones stay one-sided: there is nothing to project.
            if ($segment->end_offset <= $segment->start_offset) {
                continue;
            }

            $segment->group_id ??= (string) Str::uuid();
            $segment->save();

            [$start, $end] = self::projectRange($from, $to, (int) $segment->start_offset, (int) $segment->end_offset);

            if ($end <= $start) {
                continue;
            }

            $twin = $toSegments->first(fn (TranscriptionSegment $candidate) => $candidate->canonical_passage_id === $segment->canonical_passage_id
                && (int) $candidate->start_offset === $start
                && (int) $candidate->end_offset === $end
                && ($candidate->group_id === null
                    || ! TranscriptionSegment::query()->where('group_id', $candidate->group_id)->whereKeyNot($candidate->id)->exists()));

            if ($twin !== null) {
                $twin->update(['group_id' => $segment->group_id]);

                continue;
            }

            $created = $to->segments()->create([
                'canonical_passage_id' => $segment->canonical_passage_id,
                'start_offset' => $start,
                'end_offset' => $end,
                'part' => $segment->part,
                'needs_review' => $segment->needs_review,
                'group_id' => $segment->group_id,
            ]);
            $toSegments->push($created);
        }
    }

    private static function healRegions(TranscriptionLayer $from, TranscriptionLayer $to): void
    {
        $toRegions = $to->regions()->get();

        foreach ($from->regions()->get() as $region) {
            if ($region->group_id !== null
                && TranscriptionRegion::query()->where('group_id', $region->group_id)->whereKeyNot($region->id)->exists()) {
                continue;
            }

            $region->group_id ??= (string) Str::uuid();
            $region->save();

            [$start, $end] = self::projectAnchors($from, $to, (int) $region->start_offset, (int) $region->end_offset);

            if ($end <= $start) {
                continue;
            }

            $twin = $toRegions->first(fn (TranscriptionRegion $candidate) => $candidate->manuscript_image_id === $region->manuscript_image_id
                && (int) $candidate->start_offset === $start
                && (int) $candidate->end_offset === $end
                && ($candidate->group_id === null
                    || ! TranscriptionRegion::query()->where('group_id', $candidate->group_id)->whereKeyNot($candidate->id)->exists()));

            if ($twin !== null) {
                $twin->update(['group_id' => $region->group_id]);

                continue;
            }

            // Mapped text maps once — a differently-drawn overlap stays as
            // the sibling's own mapping rather than being duplicated.
            $overlaps = $toRegions->contains(fn (TranscriptionRegion $candidate) => $candidate->start_offset < $end && $candidate->end_offset > $start);

            if ($overlaps) {
                continue;
            }

            $created = $to->regions()->create([
                'manuscript_image_id' => $region->manuscript_image_id,
                'text' => mb_substr($to->text, $start, $end - $start),
                'start_offset' => $start,
                'end_offset' => $end,
                'position' => ($to->regions()->max('position') ?? 0) + 1,
                'x' => $region->x,
                'y' => $region->y,
                'width' => $region->width,
                'height' => $region->height,
                'needs_review' => $region->needs_review,
                'group_id' => $region->group_id,
            ]);
            $toRegions->push($created);
        }
    }
}
