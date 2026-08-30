<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateTranscriptionTextRequest;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Support\Transcription\SpanTransformer;
use App\Support\Transcription\TextOpApplier;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TranscriptionTextController extends Controller
{
    /**
     * Apply an ordered log of exact edit operations to a transcription's text,
     * transforming every citation span and image-alignment region's offsets
     * deterministically in the same pass — see SpanTransformer for how.
     *
     * The server never trusts the client's own offsets or resulting text
     * directly: it independently replays `ops` against its own stored text
     * and rejects the request if that doesn't match what the client
     * submitted (most likely a concurrent edit by another editor, since
     * transcription editing here is fully collaborative with no per-author
     * lock).
     */
    public function update(UpdateTranscriptionTextRequest $request, Transcription $transcription): RedirectResponse
    {
        DB::transaction(function () use ($request, $transcription) {
            $ops = $this->normalizeOps($request->validated('ops'));
            $recomputedText = TextOpApplier::applyAll($transcription->text, $ops);
            $submittedText = $request->validated('text') ?? '';

            if ($recomputedText !== $submittedText) {
                throw ValidationException::withMessages([
                    'text' => 'This transcription changed since you started editing — reload and try again.',
                ]);
            }

            $this->applySpans($transcription->segments, $ops);
            $this->applySpans($transcription->regions, $ops, $recomputedText);

            $transcription->update(['text' => $recomputedText]);
        });

        return back();
    }

    /**
     * @param  list<array{start: mixed, end: mixed, text: mixed}>  $ops
     * @return list<array{start: int, end: int, text: string}>
     */
    private function normalizeOps(array $ops): array
    {
        return array_map(fn (array $op) => [
            'start' => (int) $op['start'],
            'end' => (int) $op['end'],
            'text' => $op['text'] ?? '',
        ], $ops);
    }

    /**
     * @param  Collection<int, TranscriptionSegment>|Collection<int, TranscriptionRegion>  $spans
     * @param  list<array{start: int, end: int, text: string}>  $ops
     */
    private function applySpans(Collection $spans, array $ops, ?string $newText = null): void
    {
        $spans = $spans->values();

        $transformed = SpanTransformer::transform(
            array_values($spans->map(fn ($span) => [
                'start' => (int) $span->start_offset,
                'end' => (int) $span->end_offset,
                'needsReview' => (bool) $span->needs_review,
            ])->all()),
            $ops,
        );

        foreach ($spans as $index => $span) {
            $result = $transformed[$index];

            if ($result['deleted']) {
                $span->delete();

                continue;
            }

            $attributes = [
                'start_offset' => $result['start'],
                'end_offset' => $result['end'],
                'needs_review' => $result['needsReview'],
            ];

            if ($newText !== null && $span instanceof TranscriptionRegion) {
                $attributes['text'] = mb_substr($newText, $result['start'], $result['end'] - $result['start']);
            }

            $span->update($attributes);
        }
    }
}
