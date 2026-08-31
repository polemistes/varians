<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateTranscriptionTextRequest;
use App\Models\LemmaReading;
use App\Models\Transcription;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Support\DeletionImpact;
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
     * transforming every citation span, image-alignment region and collation
     * reading's offsets deterministically in the same pass — see
     * SpanTransformer for how.
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
            $this->applyReadings($transcription, $ops, $request->validated('lost_readings'));

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

    /**
     * Collation readings carry offsets into this same text, so they transform
     * exactly like segments and regions — with one deliberate exception.
     *
     * A span whose text is removed outright comes back `deleted` from
     * SpanTransformer, and for a segment or region that simply means deleting
     * the row. A LemmaReading is not disposable in the same way:
     * edition_lemmas.selected_reading_id is NOT NULL and cascades, so
     * deleting one silently discards that reading's selection in *every*
     * edition of the work — an editorial decision, destroyed by what the
     * editor experienced as a typo fix. So this refuses the save and asks
     * (see UpdateTranscriptionTextRequest::rules `lost_readings`); only on
     * the re-submit, carrying her answer, does it act. Keeping a reading
     * leaves it collapsed at the edit point and flagged for review rather
     * than reporting words the manuscript no longer has.
     *
     * A merely *partial* overlap needs no such question — the reading
     * survives with transformed offsets and `needs_review`, same as a
     * segment.
     *
     * @param  list<array{start: int, end: int, text: string}>  $ops
     */
    private function applyReadings(Transcription $transcription, array $ops, ?string $lostReadings): void
    {
        $readings = $transcription->lemmaReadings()
            ->whereNotNull('start_offset')
            ->whereNotNull('end_offset')
            ->get()
            ->values();

        if ($readings->isEmpty()) {
            return;
        }

        $transformed = SpanTransformer::transform(
            array_values($readings->map(fn (LemmaReading $reading) => [
                'start' => (int) $reading->start_offset,
                'end' => (int) $reading->end_offset,
                'needsReview' => (bool) $reading->needs_review,
            ])->all()),
            $ops,
        );

        $lostIds = array_values(
            $readings
                ->filter(fn (LemmaReading $reading, int $index) => $transformed[$index]['deleted'])
                ->map(fn (LemmaReading $reading): int => $reading->id)
                ->all()
        );

        if ($lostIds !== [] && $lostReadings === null) {
            throw ValidationException::withMessages([
                'lost_readings' => $this->lostReadingsMessage($lostIds),
            ]);
        }

        foreach ($readings as $index => $reading) {
            $result = $transformed[$index];

            if ($result['deleted']) {
                if ($lostReadings === 'delete') {
                    $reading->delete();

                    continue;
                }

                $reading->update([
                    'start_offset' => $result['start'],
                    'end_offset' => $result['start'],
                    'needs_review' => true,
                ]);

                continue;
            }

            $reading->update([
                'start_offset' => $result['start'],
                'end_offset' => $result['end'],
                'needs_review' => $result['needsReview'],
            ]);
        }
    }

    /**
     * Names the cost in the editor's own terms — how much collation, and how
     * many editions' decisions, this edit stands to discard. The wording
     * mirrors the existing deletion warnings (see resources/js/lib/
     * deletionImpact.ts) so the two read alike.
     *
     * @param  list<int>  $lostIds
     */
    private function lostReadingsMessage(array $lostIds): string
    {
        $impact = DeletionImpact::forLostReadings($lostIds);
        $readings = $impact['readings'];
        $selections = $impact['editionSelections'];

        $message = $readings === 1
            ? 'This edit removes the text 1 collated reading was taken from'
            : "This edit removes the text {$readings} collated readings were taken from";

        if ($selections > 0) {
            $message .= $selections === 1
                ? ', including 1 lemma selection in an edition'
                : ", including {$selections} lemma selections in editions";
        }

        return $message.'.';
    }
}
