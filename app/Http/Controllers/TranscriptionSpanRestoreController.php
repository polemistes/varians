<?php

namespace App\Http\Controllers;

use App\Http\Requests\RestoreTranscriptionSpansRequest;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Support\Transcription\CitationIntegrity;
use App\Support\Transcription\SiblingSync;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class TranscriptionSpanRestoreController extends Controller
{
    /**
     * Put the spans back the way they stood before an edit that is now
     * undone. Two kinds of row come here from the client's edit history:
     *
     * - `segments`/`regions`: rows the edit DELETED outright (deleting text
     *   deletes citations and image mappings), re-created verbatim. A
     *   citation whose landing words already carry the same assignment is
     *   skipped (the redo/undo dance must not duplicate); a mapping is
     *   skipped where the target already maps overlapping text (mapped
     *   once, like span-copy) or where its image belongs to another witness.
     *
     * - `adjust_segments`/`adjust_regions`: rows that SURVIVED the edit but
     *   came out of the undo with the wrong bounds. Undoing a deletion at
     *   the head of a span re-inserts the words, and the span's start has
     *   right-gravity, so the transform pushes the span past them instead
     *   of covering them again (real bug: "the fox" cited, delete "fo",
     *   undo, and the citation covered only "x"). The history snapshots
     *   every live span before the edit and posts the ones that differ
     *   afterwards; the counterpart in an in-step sibling follows.
     *
     * Healing then gives restored spans their sibling counterparts exactly
     * as fresh ones would get them.
     */
    public function store(RestoreTranscriptionSpansRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        DB::transaction(function () use ($request, $transcription) {
            foreach ($request->validated('segments') ?? [] as $row) {
                $alreadyAssigned = $transcription->segments()
                    ->where('canonical_passage_id', (int) $row['canonical_passage_id'])
                    ->where('start_offset', '<', (int) $row['end_offset'])
                    ->where('end_offset', '>', (int) $row['start_offset'])
                    ->exists();

                if ($alreadyAssigned) {
                    continue;
                }

                $transcription->segments()->create([
                    'canonical_passage_id' => (int) $row['canonical_passage_id'],
                    'start_offset' => (int) $row['start_offset'],
                    'end_offset' => (int) $row['end_offset'],
                    'part' => (int) $row['part'],
                    'group_id' => (string) Str::uuid(),
                ]);
            }

            foreach ($request->validated('regions') ?? [] as $row) {
                // A mapping is a fact about ONE parchment — an image from
                // another witness cannot be restored onto this one.
                $image = ManuscriptImage::find((int) $row['manuscript_image_id']);

                if ($image === null || $image->witness_id !== $transcription->transcription->witness_id) {
                    continue;
                }

                $alreadyMapped = $transcription->regions()
                    ->where('start_offset', '<', (int) $row['end_offset'])
                    ->where('end_offset', '>', (int) $row['start_offset'])
                    ->exists();

                if ($alreadyMapped) {
                    continue;
                }

                $transcription->regions()->create([
                    'manuscript_image_id' => $image->id,
                    'start_offset' => (int) $row['start_offset'],
                    'end_offset' => (int) $row['end_offset'],
                    // The denormalized excerpt is recomputed, never trusted
                    // from the client — the restored text is authoritative.
                    'text' => mb_substr($transcription->text, (int) $row['start_offset'], (int) $row['end_offset'] - (int) $row['start_offset']),
                    'position' => (int) $row['position'],
                    'x' => (float) $row['x'],
                    'y' => (float) $row['y'],
                    'width' => (float) $row['width'],
                    'height' => (float) $row['height'],
                    'group_id' => (string) Str::uuid(),
                ]);
            }

            foreach ($request->validated('adjust_segments') ?? [] as $row) {
                $segment = $transcription->segments()->find((int) $row['id']);

                if ($segment === null) {
                    continue;
                }

                $segment->update([
                    'start_offset' => (int) $row['start_offset'],
                    'end_offset' => (int) $row['end_offset'],
                    'needs_review' => (bool) ($row['needs_review'] ?? $segment->needs_review),
                ]);
                SiblingSync::followSegment($segment);
            }

            foreach ($request->validated('adjust_regions') ?? [] as $row) {
                $region = $transcription->regions()->find((int) $row['id']);

                if ($region === null) {
                    continue;
                }

                $region->update([
                    'start_offset' => (int) $row['start_offset'],
                    'end_offset' => (int) $row['end_offset'],
                    'text' => mb_substr($transcription->text, (int) $row['start_offset'], (int) $row['end_offset'] - (int) $row['start_offset']),
                    'needs_review' => (bool) ($row['needs_review'] ?? $region->needs_review),
                ]);
                SiblingSync::followRegion($region);
            }

            SiblingSync::heal($transcription->refresh());

            foreach ($transcription->transcription->layers as $layer) {
                $drift = CitationIntegrity::snap($layer);

                if ($drift !== []) {
                    Log::warning('Citation spans drifted off their words after an undo restore', [
                        'layer' => $layer->id,
                        'adjust_segments' => $request->validated('adjust_segments') ?? [],
                        'issues' => $drift,
                    ]);
                }
            }
        });

        return back();
    }
}
