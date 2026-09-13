<?php

namespace App\Http\Controllers;

use App\Http\Requests\RestoreTranscriptionSpansRequest;
use App\Models\ManuscriptImage;
use App\Models\TranscriptionLayer;
use App\Support\Transcription\AssignmentIntegrity;
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
     * - `assignments`/`regions`: rows the edit DELETED outright (deleting text
     *   deletes assignments and image mappings), re-created verbatim. An
     *   assignment whose landing words already carry an assignment — the
     *   same one (the redo/undo dance must not duplicate) or any other
     *   (text is assigned once) — is skipped; a mapping is
     *   skipped where the target already maps overlapping text (mapped
     *   once, like span-copy) or where its image belongs to another witness.
     *
     * - `adjust_assignments`/`adjust_regions`: rows that SURVIVED the edit but
     *   came out of the undo with the wrong bounds. Undoing a deletion at
     *   the head of a span re-inserts the words, and the span's start has
     *   right-gravity, so the transform pushes the span past them instead
     *   of covering them again (real bug: "the fox" assigned, delete "fo",
     *   undo, and the assignment covered only "x"). The history snapshots
     *   every live span before the edit and posts the ones that differ
     *   afterwards; the counterpart in an in-step sibling follows.
     *
     * Healing then gives restored spans their sibling counterparts exactly
     * as fresh ones would get them.
     */
    public function store(RestoreTranscriptionSpansRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        DB::transaction(function () use ($request, $transcription) {
            foreach ($request->validated('assignments') ?? [] as $row) {
                $alreadyAssigned = $transcription->assignments()
                    ->where('start_offset', '<', (int) $row['end_offset'])
                    ->where('end_offset', '>', (int) $row['start_offset'])
                    ->exists();

                if ($alreadyAssigned) {
                    continue;
                }

                $transcription->assignments()->create([
                    'segment_id' => (int) $row['segment_id'],
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

            foreach ($request->validated('adjust_assignments') ?? [] as $row) {
                $assignment = $transcription->assignments()->find((int) $row['id']);

                if ($assignment === null) {
                    continue;
                }

                $assignment->update([
                    'start_offset' => (int) $row['start_offset'],
                    'end_offset' => (int) $row['end_offset'],
                    'needs_review' => (bool) ($row['needs_review'] ?? $assignment->needs_review),
                ]);
                SiblingSync::followAssignment($assignment);
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
                $drift = AssignmentIntegrity::snap($layer);

                if ($drift !== []) {
                    Log::warning('Assignment spans drifted off their words after an undo restore', [
                        'layer' => $layer->id,
                        'adjust_assignments' => $request->validated('adjust_assignments') ?? [],
                        'issues' => $drift,
                    ]);
                }
            }
        });

        return back();
    }
}
