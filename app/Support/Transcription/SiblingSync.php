<?php

namespace App\Support\Transcription;

use App\Models\Assignment;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
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
     * The sibling's character range for the same WORDS — for assignment
     * assignments, which are word-granular.
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
    public static function counterpartAssignment(Assignment $assignment): ?Assignment
    {
        return Assignment::query()
            ->where('group_id', $assignment->group_id)
            ->whereKeyNot($assignment->id)
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
     * Carry an assignment's bounds and flag over to its counterpart, projected
     * into the sibling's own spelling — the one identity seen from the other
     * side. Nothing happens while the layers are out of step: a projection
     * would name the wrong words, and heal() catches up once they agree.
     */
    public static function followAssignment(Assignment $assignment): void
    {
        $counterpart = self::counterpartAssignment($assignment);
        $layer = $assignment->transcriptionLayer;

        if ($counterpart === null || self::inStepSibling($layer) === null) {
            return;
        }

        [$start, $end] = self::projectRange(
            $layer,
            $counterpart->transcriptionLayer,
            (int) $assignment->start_offset,
            (int) $assignment->end_offset,
        );

        if ($end > $start) {
            $counterpart->update([
                'start_offset' => $start,
                'end_offset' => $end,
                'needs_review' => $assignment->needs_review,
            ]);
        }
    }

    /**
     * The same for a facsimile mapping, through sub-word anchors; the box
     * itself is shared geometry and travels as it is.
     */
    public static function followRegion(TranscriptionRegion $region): void
    {
        $counterpart = self::counterpartRegion($region);
        $layer = $region->transcriptionLayer;

        if ($counterpart === null || self::inStepSibling($layer) === null) {
            return;
        }

        $sibling = $counterpart->transcriptionLayer;
        [$start, $end] = self::projectAnchors($layer, $sibling, (int) $region->start_offset, (int) $region->end_offset);

        if ($end > $start) {
            $counterpart->update([
                'start_offset' => $start,
                'end_offset' => $end,
                'text' => mb_substr($sibling->text, $start, $end - $start),
                'needs_review' => $region->needs_review,
            ]);
        }
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
            self::healAssignments($side, $other);
            self::healRegions($side, $other);
        }
    }

    private static function healAssignments(TranscriptionLayer $from, TranscriptionLayer $to): void
    {
        $toAssignments = $to->assignments()->get();

        foreach ($from->assignments()->get() as $assignment) {
            // Tombstones stay one-sided: there is nothing to project.
            if ($assignment->end_offset <= $assignment->start_offset) {
                continue;
            }

            $counterpart = $assignment->group_id === null
                ? null
                : Assignment::query()->where('group_id', $assignment->group_id)->whereKeyNot($assignment->id)->first();

            if ($counterpart !== null) {
                // A live span whose other half was tombstoned by an edit
                // that never mirrored: in step again, the projection names
                // its words — revive it.
                if ($counterpart->end_offset <= $counterpart->start_offset) {
                    [$start, $end] = self::projectRange($from, $to, (int) $assignment->start_offset, (int) $assignment->end_offset);

                    if ($end > $start) {
                        $counterpart->update([
                            'start_offset' => $start,
                            'end_offset' => $end,
                            'needs_review' => $assignment->needs_review,
                        ]);
                    }
                }

                continue;
            }

            $assignment->group_id ??= (string) Str::uuid();
            $assignment->save();

            [$start, $end] = self::projectRange($from, $to, (int) $assignment->start_offset, (int) $assignment->end_offset);

            if ($end <= $start) {
                continue;
            }

            $twin = $toAssignments->first(fn (Assignment $candidate) => $candidate->canonical_passage_id === $assignment->canonical_passage_id
                && (int) $candidate->start_offset === $start
                && (int) $candidate->end_offset === $end
                && ($candidate->group_id === null
                    || ! Assignment::query()->where('group_id', $candidate->group_id)->whereKeyNot($candidate->id)->exists()));

            if ($twin !== null) {
                $twin->update(['group_id' => $assignment->group_id]);

                continue;
            }

            // Never manufacture a duplicate: an overlapping live assignment
            // of the same passage already covers (some of) these words.
            $overlapping = $toAssignments->contains(fn (Assignment $candidate) => $candidate->canonical_passage_id === $assignment->canonical_passage_id
                && $candidate->end_offset > $candidate->start_offset
                && $candidate->start_offset < $end
                && $candidate->end_offset > $start);

            if ($overlapping) {
                continue;
            }

            $created = $to->assignments()->create([
                'canonical_passage_id' => $assignment->canonical_passage_id,
                'start_offset' => $start,
                'end_offset' => $end,
                'part' => $assignment->part,
                'needs_review' => $assignment->needs_review,
                'group_id' => $assignment->group_id,
            ]);
            $toAssignments->push($created);
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
