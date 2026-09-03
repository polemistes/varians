<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTranscriptionSpanCopyRequest;
use App\Models\TranscriptionLayer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TranscriptionSpanCopyController extends Controller
{
    /**
     * Bring the citation assignments and facsimile mappings along when text
     * is copied from one layer and pasted into another: the client pairs a
     * copy with its paste (same characters, different layer) and posts the
     * source range and the landing offset here, AFTER the pasted text has
     * been saved.
     *
     * Only spans wholly inside the copied range travel. A copied segment
     * joins its passage's citation in the target as a further part (the
     * target may legitimately cite it already); a copied mapping is skipped
     * where the target already maps overlapping text — mapped text maps
     * once. The source is untouched: this is a copy.
     */
    public function store(StoreTranscriptionSpanCopyRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $source = TranscriptionLayer::query()
            ->with([
                'segments' => fn ($query) => $query->orderBy('start_offset'),
                'regions' => fn ($query) => $query->orderBy('position'),
            ])
            ->whereKey($request->validated('source_layer_id'))
            ->firstOrFail();

        if ($source->transcription->witness_id !== $transcription->transcription->witness_id) {
            throw ValidationException::withMessages([
                'source_layer_id' => 'Assignments only travel between layers of the same witness — use “Copy layer…” for another witness.',
            ]);
        }

        $start = (int) $request->validated('source_start');
        $end = (int) $request->validated('source_end');
        $at = (int) $request->validated('target_offset');
        $length = $end - $start;

        // The pasted characters must still stand at both ends, or the spans
        // would land on other words than the ones they describe.
        if (mb_substr($source->text, $start, $length) !== mb_substr($transcription->text, $at, $length)) {
            throw ValidationException::withMessages([
                'target_offset' => 'The copied text no longer matches — nothing was brought along.',
            ]);
        }

        [$citations, $mappings] = DB::transaction(function () use ($source, $transcription, $start, $end, $at) {
            $shift = $at - $start;
            $citations = 0;
            $mappings = 0;
            $nextPart = [];

            $inside = $source->segments
                ->filter(fn ($segment) => $segment->start_offset >= $start
                    && $segment->end_offset <= $end
                    && $segment->end_offset > $segment->start_offset)
                ->sortBy([['canonical_passage_id', 'asc'], ['part', 'asc']]);

            foreach ($inside as $segment) {
                // A further part of the passage's citation in the target, in
                // the copied content order — the target may already cite it.
                $passageId = $segment->canonical_passage_id;
                $nextPart[$passageId] ??= ((int) $transcription->segments()
                    ->where('canonical_passage_id', $passageId)->max('part')) + 1;

                $transcription->segments()->create([
                    'canonical_passage_id' => $passageId,
                    'start_offset' => $segment->start_offset + $shift,
                    'end_offset' => $segment->end_offset + $shift,
                    'part' => $nextPart[$passageId]++,
                    'needs_review' => $segment->needs_review,
                ]);
                $citations++;
            }

            $position = (int) ($transcription->regions()->max('position') ?? 0);

            foreach ($source->regions as $region) {
                if ($region->start_offset < $start || $region->end_offset > $end) {
                    continue;
                }

                $movedStart = $region->start_offset + $shift;
                $movedEnd = $region->end_offset + $shift;

                // Mapped text maps once — where the target already maps
                // overlapping text, the copied mapping is skipped.
                $overlaps = $transcription->regions()
                    ->where('start_offset', '<', $movedEnd)
                    ->where('end_offset', '>', $movedStart)
                    ->exists();

                if ($overlaps) {
                    continue;
                }

                $transcription->regions()->create([
                    'manuscript_image_id' => $region->manuscript_image_id,
                    'text' => $region->text,
                    'start_offset' => $movedStart,
                    'end_offset' => $movedEnd,
                    'position' => ++$position,
                    'x' => $region->x,
                    'y' => $region->y,
                    'width' => $region->width,
                    'height' => $region->height,
                ]);
                $mappings++;
            }

            return [$citations, $mappings];
        });

        if ($citations > 0 || $mappings > 0) {
            $parts = [];

            if ($citations > 0) {
                $parts[] = $citations.' citation'.($citations === 1 ? '' : 's');
            }

            if ($mappings > 0) {
                $parts[] = $mappings.' facsimile mapping'.($mappings === 1 ? '' : 's');
            }

            session()->flash('message', 'Brought '.implode(' and ', $parts).' along with the pasted text.');
        }

        return back();
    }
}
