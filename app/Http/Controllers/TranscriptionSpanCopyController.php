<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTranscriptionSpanCopyRequest;
use App\Models\TranscriptionLayer;
use App\Support\Transcription\SiblingSync;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class TranscriptionSpanCopyController extends Controller
{
    /**
     * Bring the spans along when text is copied from one layer and pasted
     * into another: the client pairs a copy with its paste (same
     * characters, different layer) and posts the source range and the
     * landing offset here, AFTER the pasted text has been saved.
     *
     * What travels depends on what stays true where the text goes.
     * Citations travel always — which passage of a work a stretch of text
     * is holds wherever it stands, so even a segment the copy cuts through
     * contributes its contained part. Facsimile mappings are facts about
     * ONE parchment: they travel within the witness (whole spans only —
     * half a box is not a meaningful geometry) and never to another
     * witness. A copied segment joins its passage's citation in the target
     * as a further part; a copied mapping is skipped where the target
     * already maps overlapping text. The source is untouched: this is a
     * copy.
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

        $sameWitness = $source->transcription->witness_id === $transcription->transcription->witness_id;

        $start = (int) $request->validated('source_start');
        $end = (int) $request->validated('source_end');
        $at = (int) $request->validated('target_offset');
        $length = $end - $start;

        // The pasted characters must still stand at both ends, or the spans
        // would land on other words than the ones they describe. A notice,
        // not a validation error: the paste itself succeeded, and the one
        // consequence the editor cannot see is that nothing came along.
        if (mb_substr($source->text, $start, $length) !== mb_substr($transcription->text, $at, $length)) {
            session()->flash('message', 'The copied text no longer matches its source — no citations or mappings were brought along.');

            return back();
        }

        [$citations, $mappings] = DB::transaction(function () use ($source, $transcription, $start, $end, $at, $sameWitness) {
            $shift = $at - $start;
            $citations = 0;
            $mappings = 0;
            $nextPart = [];

            // Overlap is enough: a segment the copy cuts through contributes
            // its contained part — still genuine text of its passage.
            $touched = $source->segments
                ->filter(fn ($segment) => $segment->start_offset < $end
                    && $segment->end_offset > $start
                    && $segment->end_offset > $segment->start_offset)
                ->sortBy([['canonical_passage_id', 'asc'], ['part', 'asc']]);

            foreach ($touched as $segment) {
                // A further part of the passage's citation in the target, in
                // the copied content order — the target may already cite it.
                $passageId = $segment->canonical_passage_id;
                $nextPart[$passageId] ??= ((int) $transcription->segments()
                    ->where('canonical_passage_id', $passageId)->max('part')) + 1;

                $transcription->segments()->create([
                    'canonical_passage_id' => $passageId,
                    'start_offset' => max($segment->start_offset, $start) + $shift,
                    'end_offset' => min($segment->end_offset, $end) + $shift,
                    'part' => $nextPart[$passageId]++,
                    'needs_review' => $segment->needs_review,
                    'group_id' => (string) Str::uuid(),
                ]);
                $citations++;
            }

            if (! $sameWitness) {
                // Mappings stay with their own parchment.
                return [$citations, 0];
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
                    'group_id' => (string) Str::uuid(),
                ]);
                $mappings++;
            }

            return [$citations, $mappings];
        });

        if ($citations > 0 || $mappings > 0) {
            // Assignments are done once per TRANSCRIPT too: when the
            // target's layers are in step, the imported spans get their
            // counterparts in the sibling layer right away, exactly as a
            // text save would.
            SiblingSync::heal($transcription->refresh());

            $parts = [];

            if ($citations > 0) {
                $parts[] = $citations.' citation'.($citations === 1 ? '' : 's');
            }

            if ($mappings > 0) {
                $parts[] = $mappings.' facsimile mapping'.($mappings === 1 ? '' : 's');
            }

            $notice = 'Brought '.implode(' and ', $parts).' along with the pasted text.';

            if (! $sameWitness) {
                $notice .= ' Facsimile mappings stay with their own witness.';
            }

            session()->flash('message', $notice);
        }

        return back();
    }
}
