<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTranscriptionRegionBatchRequest;
use App\Http\Requests\StoreTranscriptionRegionRequest;
use App\Http\Requests\UpdateTranscriptionRegionRequest;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Support\Transcription\RegionSplitter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TranscriptionRegionController extends Controller
{
    public function store(StoreTranscriptionRegionRequest $request, Transcription $transcription): RedirectResponse
    {
        $transcription->regions()->create([
            ...$request->validated(),
            'position' => ($transcription->regions()->max('position') ?? 0) + 1,
        ]);

        return back();
    }

    /**
     * Draw one guide box over a line/phrase and get one region per
     * character or word, evenly divided along the box — a uniform-spacing
     * approximation rather than real letter-detection, which this project
     * deliberately avoids as too unreliable. Each generated region can be
     * moved/resized individually afterward via `update()`.
     */
    public function storeBatch(StoreTranscriptionRegionBatchRequest $request, Transcription $transcription): RedirectResponse
    {
        $start = $request->validated('start_offset');
        $end = $request->validated('end_offset');
        $text = mb_substr($transcription->text, $start, $end - $start);

        if (! RegionSplitter::isSplittable($text)) {
            throw ValidationException::withMessages([
                'start_offset' => 'This selection contains transcription markup (a gap, restoration, or uncertain reading) — batch alignment only works on plain text. Align it manually instead, or select a smaller span.',
            ]);
        }

        $units = RegionSplitter::split($text, $request->validated('granularity'));

        if ($units === []) {
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
        $cellWidth = $box['width'] / count($units);

        DB::transaction(function () use ($request, $transcription, $units, $box, $cellWidth, $start) {
            $position = $transcription->regions()->max('position') ?? 0;

            foreach ($units as $index => $unit) {
                $transcription->regions()->create([
                    'manuscript_image_id' => $request->validated('manuscript_image_id'),
                    'text' => $unit['text'],
                    'start_offset' => $start + $unit['start'],
                    'end_offset' => $start + $unit['end'],
                    'position' => ++$position,
                    'x' => $box['x'] + $cellWidth * $index,
                    'y' => $box['y'],
                    'width' => $cellWidth,
                    'height' => $box['height'],
                ]);
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
        $region->update([...$request->validated(), 'needs_review' => false]);

        return back();
    }

    public function destroy(TranscriptionRegion $region): RedirectResponse
    {
        $region->delete();

        return back();
    }
}
