<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTranscriptionRegionBatchRequest;
use App\Http\Requests\StoreTranscriptionRegionRequest;
use App\Http\Requests\UpdateTranscriptionRegionRequest;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionRegion;
use App\Support\Transcription\RegionSplitter;
use App\Support\Transcription\SiblingSync;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TranscriptionRegionController extends Controller
{
    public function store(StoreTranscriptionRegionRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $this->guardUnmapped(
            $transcription,
            (int) $request->validated('start_offset'),
            (int) $request->validated('end_offset'),
        );

        DB::transaction(function () use ($request, $transcription) {
            $region = $transcription->regions()->create([
                ...$request->validated(),
                'position' => ($transcription->regions()->max('position') ?? 0) + 1,
            ]);

            $this->syncSiblingMapping($region);
        });

        return back();
    }

    /**
     * A mapping is DONE ONCE: the in-step sibling layer receives the same
     * box over the same words, its offsets projected through sub-word
     * anchors into its own spelling — skipped where the sibling already
     * maps overlapping text (mapped text maps once).
     */
    private function syncSiblingMapping(TranscriptionRegion $region): void
    {
        $layer = $region->transcriptionLayer;
        $sibling = SiblingSync::inStepSibling($layer);

        if ($sibling === null) {
            return;
        }

        [$start, $end] = SiblingSync::projectAnchors($layer, $sibling, (int) $region->start_offset, (int) $region->end_offset);

        if ($end <= $start) {
            return;
        }

        $overlaps = $sibling->regions()
            ->where('start_offset', '<', $end)
            ->where('end_offset', '>', $start)
            ->exists();

        if ($overlaps) {
            return;
        }

        $sibling->regions()->create([
            'manuscript_image_id' => $region->manuscript_image_id,
            'text' => mb_substr($sibling->text, $start, $end - $start),
            'start_offset' => $start,
            'end_offset' => $end,
            'position' => ($sibling->regions()->max('position') ?? 0) + 1,
            'x' => $region->x,
            'y' => $region->y,
            'width' => $region->width,
            'height' => $region->height,
        ]);
    }

    /**
     * The sibling's mapping of the same words on the same image, if the
     * layers are in step.
     */
    private function siblingCounterpart(TranscriptionRegion $region): ?TranscriptionRegion
    {
        $layer = $region->transcriptionLayer;
        $sibling = SiblingSync::inStepSibling($layer);

        if ($sibling === null) {
            return null;
        }

        [$start, $end] = SiblingSync::projectAnchors($layer, $sibling, (int) $region->start_offset, (int) $region->end_offset);

        return $sibling->regions()
            ->where('manuscript_image_id', $region->manuscript_image_id)
            ->where('start_offset', $start)
            ->where('end_offset', $end)
            ->first();
    }

    /**
     * Text maps to the facsimile once: a second box over the same words
     * would silently duplicate the alignment. Remapping is an explicit
     * remove-then-redraw.
     */
    private function guardUnmapped(TranscriptionLayer $transcription, int $start, int $end): void
    {
        $overlaps = $transcription->regions()
            ->where('start_offset', '<', $end)
            ->where('end_offset', '>', $start)
            ->exists();

        if ($overlaps) {
            throw ValidationException::withMessages([
                'start_offset' => 'Part of this selection is already mapped to the facsimile — remove the existing mapping first.',
            ]);
        }
    }

    /**
     * Draw one guide box over the selection's lines on the facsimile and get
     * one region per character or word: the box divides vertically into one
     * band per line of the selection, and each band divides horizontally by
     * character count, so word widths follow letter counts and spaces keep
     * their share. An approximation rather than real letter-detection, which
     * this project deliberately avoids as too unreliable — each generated
     * region can be moved/resized individually afterward via `update()`.
     */
    public function storeBatch(StoreTranscriptionRegionBatchRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $start = $request->validated('start_offset');
        $end = $request->validated('end_offset');
        $text = mb_substr($transcription->text, $start, $end - $start);

        // Markup only misleads a division WITHIN a line — a gap has no ink,
        // so character-count widths misplace every unit after it. A whole
        // line fills its band regardless, exactly like the manual single-box
        // path, so gapped text can still be mapped line by line.
        if ($request->validated('granularity') !== 'line' && ! RegionSplitter::isSplittable($text)) {
            throw ValidationException::withMessages([
                'start_offset' => 'This selection contains transcription markup (a gap, restoration, or uncertain reading) — batch alignment only works on plain text. Align it manually instead, or select a smaller span.',
            ]);
        }

        $this->guardUnmapped($transcription, (int) $start, (int) $end);

        $layout = RegionSplitter::layout($text, $request->validated('granularity'));

        if ($layout['units'] === []) {
            throw ValidationException::withMessages([
                'start_offset' => 'Nothing to align in that selection.',
            ]);
        }

        $box = [
            'x' => (float) $request->validated('x'),
            'y' => (float) $request->validated('y'),
            'width' => (float) $request->validated('width'),
            'height' => (float) $request->validated('height'),
        ];
        $bandHeight = $box['height'] / $layout['lines'];

        DB::transaction(function () use ($request, $transcription, $layout, $box, $bandHeight, $start) {
            $position = $transcription->regions()->max('position') ?? 0;

            foreach ($layout['units'] as $unit) {
                $region = $transcription->regions()->create([
                    'manuscript_image_id' => $request->validated('manuscript_image_id'),
                    'text' => $unit['text'],
                    'start_offset' => $start + $unit['start'],
                    'end_offset' => $start + $unit['end'],
                    'position' => ++$position,
                    'x' => $box['x'] + $unit['x'] * $box['width'],
                    'y' => $box['y'] + $unit['line'] * $bandHeight,
                    'width' => $unit['width'] * $box['width'],
                    'height' => $bandHeight,
                ]);

                $this->syncSiblingMapping($region);
            }
        });

        return back();
    }

    /**
     * Move or resize a region. Clears needs_review — a manual re-placement
     * is a live human confirmation.
     */
    public function update(UpdateTranscriptionRegionRequest $request, TranscriptionRegion $region): RedirectResponse
    {
        DB::transaction(function () use ($request, $region) {
            $counterpart = $this->siblingCounterpart($region);

            $region->update([...$request->validated(), 'needs_review' => false]);

            $counterpart?->update([
                'x' => $region->x,
                'y' => $region->y,
                'width' => $region->width,
                'height' => $region->height,
                'needs_review' => false,
            ]);
        });

        return back();
    }

    public function destroy(TranscriptionRegion $region): RedirectResponse
    {
        DB::transaction(function () use ($region) {
            $this->siblingCounterpart($region)?->delete();
            $region->delete();
        });

        return back();
    }
}
