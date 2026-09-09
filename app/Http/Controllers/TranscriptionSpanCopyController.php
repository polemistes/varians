<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreTranscriptionSpanCopyRequest;
use App\Models\TranscriptionLayer;
use App\Support\Transcription\CitationIntegrity;
use App\Support\Transcription\SiblingSync;
use App\Support\Transcription\WorkOwnership;
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

        // Citations travel with the text — but within one witness a work
        // lives in one transcript (WorkOwnership), so a copy from another
        // transcript of the same witness may not bring its citations here.
        if ($sameWitness && $source->transcription_id !== $transcription->transcription_id) {
            $works = $source->segments
                ->filter(fn ($segment) => $segment->start_offset < (int) $request->validated('source_end')
                    && $segment->end_offset > (int) $request->validated('source_start'))
                ->map(fn ($segment) => $segment->canonicalPassage?->work)
                ->filter()
                ->unique('id');

            foreach ($works as $work) {
                WorkOwnership::guard($transcription->transcription, $work, 'source_layer_id');
            }
        }

        $start = (int) $request->validated('source_start');
        $end = (int) $request->validated('source_end');
        $at = (int) $request->validated('target_offset');
        $length = $end - $start;

        // The pasted characters must still stand at both ends, or the spans
        // would land on other words than the ones they describe. A notice,
        // not a validation error: the paste itself succeeded, and the one
        // consequence the editor cannot see is that nothing came along.
        if (mb_substr($source->text, $start, $length) !== mb_substr($transcription->text, $at, $length)) {
            session()->flash('message', 'The copied text no longer matches its source — no assignments or image mappings were brought along.');
            session()->flash('message_layer_id', $transcription->id);

            return back();
        }

        [$citations, $mappings] = DB::transaction(function () use ($source, $transcription, $start, $end, $at, $sameWitness) {
            $shift = $at - $start;
            $citations = 0;
            $mappings = 0;
            $nextPart = [];

            // Snapshot before anything travels: these are the spans that may
            // have absorbed the pasted text when it saved, and the clipping
            // below must never touch the rows created here.
            $standing = $transcription->segments()->orderBy('start_offset')->get();

            // Overlap is enough: a segment the copy cuts through contributes
            // its contained part — still genuine text of its passage.
            $touched = $source->segments
                ->filter(fn ($segment) => $segment->start_offset < $end
                    && $segment->end_offset > $start
                    && $segment->end_offset > $segment->start_offset)
                ->sortBy([['canonical_passage_id', 'asc'], ['part', 'asc']]);

            $landings = [];

            foreach ($touched as $segment) {
                // A further part of the passage's assignment in the target,
                // in the copied content order — the target may already
                // assign it elsewhere.
                $passageId = $segment->canonical_passage_id;
                $landStart = max($segment->start_offset, $start) + $shift;
                $landEnd = min($segment->end_offset, $end) + $shift;

                // Assigned once: where the landing words already carry this
                // very assignment — e.g. the sibling-healing pass restored
                // it the moment the pasted text saved — a second part would
                // only duplicate it (real bug: every pasted assignment
                // showed as 1/2).
                $alreadyAssigned = $transcription->segments()
                    ->where('canonical_passage_id', $passageId)
                    ->where('start_offset', '<', $landEnd)
                    ->where('end_offset', '>', $landStart)
                    ->exists();

                if ($alreadyAssigned) {
                    continue;
                }

                $nextPart[$passageId] ??= ((int) $transcription->segments()
                    ->where('canonical_passage_id', $passageId)->max('part')) + 1;

                $transcription->segments()->create([
                    'canonical_passage_id' => $passageId,
                    'start_offset' => $landStart,
                    'end_offset' => $landEnd,
                    'part' => $nextPart[$passageId]++,
                    'needs_review' => $segment->needs_review,
                    'group_id' => (string) Str::uuid(),
                ]);
                $citations++;
                $landings[] = [$landStart, $landEnd];
            }

            // The pasted words belong to the citations that traveled with
            // them, never to a target span that merely absorbed the arrival:
            // the text save that preceded this request extends a span whose
            // end sits exactly at the paste point (end-gravity — right for
            // typing, wrong for a carrying paste), and a paste into the
            // middle of a cited span lands inside it. Mirror the relocation
            // twin (RelocationSegmentEffects): a span covering an arrival on
            // both sides splits into two parts of its own passage; one
            // overlapping from a single side is clipped back to the
            // boundary. Unflagged — nothing needs review once the arrival
            // carries its own citation. Without this, a cross-layer paste
            // right after a cited line left the neighbour's span covering
            // the whole arrival, overlapping the traveled citation (real
            // bug, found in live data).
            foreach ($landings as [$landStart, $landEnd]) {
                foreach ($standing as $bystander) {
                    $overlaps = $bystander->start_offset < $landEnd
                        && $bystander->end_offset > $landStart;

                    if (! $overlaps) {
                        continue;
                    }

                    $coversLeft = $bystander->start_offset < $landStart;
                    $coversRight = $bystander->end_offset > $landEnd;

                    if ($coversLeft && $coversRight) {
                        $nextPart[$bystander->canonical_passage_id] ??= ((int) $transcription->segments()
                            ->where('canonical_passage_id', $bystander->canonical_passage_id)->max('part')) + 1;

                        $transcription->segments()->create([
                            'canonical_passage_id' => $bystander->canonical_passage_id,
                            'start_offset' => $landEnd,
                            'end_offset' => $bystander->end_offset,
                            'part' => $nextPart[$bystander->canonical_passage_id]++,
                            'needs_review' => $bystander->needs_review,
                            'group_id' => (string) Str::uuid(),
                        ]);
                        $bystander->update(['end_offset' => $landStart]);
                    } elseif ($coversLeft) {
                        $bystander->update(['end_offset' => $landStart]);
                    } elseif ($coversRight) {
                        $bystander->update(['start_offset' => $landEnd]);
                    }
                    // Wholly inside the arrival cannot come from absorbing an
                    // insertion — leave it for a human.
                }
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

            foreach ($transcription->transcription->layers as $layer) {
                CitationIntegrity::snap($layer);
            }

            $parts = [];

            if ($citations > 0) {
                $parts[] = $citations.' assignment'.($citations === 1 ? '' : 's');
            }

            if ($mappings > 0) {
                $parts[] = $mappings.' image mapping'.($mappings === 1 ? '' : 's');
            }

            $notice = 'Brought '.implode(' and ', $parts).' along with the pasted text.';

            if (! $sameWitness) {
                $notice .= ' Image mappings stay with their own witness.';
            }

            session()->flash('message', $notice);
            session()->flash('message_layer_id', $transcription->id);
        }

        return back();
    }
}
