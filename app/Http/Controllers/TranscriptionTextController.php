<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateTranscriptionTextRequest;
use App\Models\EditionLemma;
use App\Models\LemmaReading;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Support\Transcription\SpanTransformer;
use App\Support\Transcription\TextOpApplier;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TranscriptionTextController extends Controller
{
    /**
     * Apply an ordered log of exact edit operations to a transcription's text,
     * transforming every citation span, image-alignment region, collation
     * reading and page break's offsets deterministically in the same pass —
     * see SpanTransformer for how.
     *
     * The server never trusts the client's own offsets or resulting text
     * directly: it independently replays `ops` against its own stored text
     * and rejects the request if that doesn't match what the client
     * submitted (most likely a concurrent edit by another editor, since
     * transcription editing here is fully collaborative with no per-author
     * lock).
     */
    public function update(UpdateTranscriptionTextRequest $request, TranscriptionLayer $transcription): RedirectResponse
    {
        $affectedEditions = DB::transaction(function () use ($request, $transcription): array {
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
            $this->applyPageBreaks($transcription, $ops, $recomputedText);
            $affected = $this->applyReadings($transcription, $ops, $recomputedText);

            $transcription->update(['text' => $recomputedText]);

            return $affected;
        });

        if ($affectedEditions !== []) {
            session()->flash('message', $this->editionReport($affectedEditions));
        }

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
     * Keep the transcription's page divisions where they belong when its text
     * changes.
     *
     * A division is a line number shared by both layers, so it does not shift
     * when characters change within a line — only when the edit adds or
     * removes whole lines before it. Rather than reason about that directly,
     * each break is resolved to this layer's offset, moved with the same
     * machinery as everything else, and read back as a line.
     *
     * Points, not spans: `transformPoints` keeps an insertion made exactly at
     * a break *after* it, so the first words typed at the top of a page belong
     * to that page. A break is never deleted — emptying a page does not
     * abolish it.
     *
     * @param  list<array{start: int, end: int, text: string}>  $ops
     */
    private function applyPageBreaks(TranscriptionLayer $transcription, array $ops, string $newText): void
    {
        $breaks = $transcription->transcription->pageBreaks()->orderBy('start_line')->get();

        if ($breaks->isEmpty()) {
            return;
        }

        $moved = SpanTransformer::transformPoints(
            array_values($breaks->map(
                fn (TranscriptionPageBreak $break) => $transcription->offsetOfLine($break->start_line)
            )->all()),
            $ops,
        );

        $after = $transcription->replicate()->forceFill(['text' => $newText]);

        foreach ($breaks as $index => $break) {
            $line = $after->lineOfOffset($moved[$index]);

            if ($line !== (int) $break->start_line) {
                $break->update(['start_line' => $line]);
            }
        }
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
     * exactly like segments and regions.
     *
     * Nothing here needs the editor's permission. An edit to a witness only
     * reaches a reader when that witness is the reading some edition prints:
     * where the edition prints a different manuscript, or a conjecture, the
     * apparatus simply reports the witness's new wording and the printed text
     * is untouched. So this acts, and `update()` reports afterwards on the one
     * case an editor cannot see coming — that her correction also changed an
     * edition's own printed words.
     *
     * A destroyed span (`deleted` from SpanTransformer — an op removed the
     * text outright) is handled by whether anything selected it. If nothing
     * did, the reading goes: the manuscript genuinely no longer has those
     * words, so dropping the candidate is the truthful outcome. If an edition
     * did select it, the row is kept as a zero-width span and flagged, since
     * edition_lemmas.selected_reading_id is NOT NULL and cascades — deleting
     * would discard that edition's decision rather than merely emptying it.
     *
     * @param  list<array{start: int, end: int, text: string}>  $ops
     * @return list<string> titles of editions whose printed wording changed
     */
    private function applyReadings(TranscriptionLayer $transcription, array $ops, string $newText): array
    {
        $readings = $transcription->lemmaReadings()
            ->whereNotNull('start_offset')
            ->whereNotNull('end_offset')
            ->get()
            ->values();

        if ($readings->isEmpty()) {
            return [];
        }

        $transformed = SpanTransformer::transform(
            array_values($readings->map(fn (LemmaReading $reading) => [
                'start' => (int) $reading->start_offset,
                'end' => (int) $reading->end_offset,
                'needsReview' => (bool) $reading->needs_review,
            ])->all()),
            $ops,
        );

        $selectingEditions = $this->selectingEditions($readings);
        $affected = [];

        foreach ($readings as $index => $reading) {
            $result = $transformed[$index];
            $selectedBy = $selectingEditions[$reading->id] ?? [];

            $before = mb_substr(
                $transcription->text,
                (int) $reading->start_offset,
                (int) $reading->end_offset - (int) $reading->start_offset,
            );

            if ($result['deleted'] && $selectedBy === []) {
                $reading->delete();

                continue;
            }

            // A destroyed span collapses to zero width at the edit point; an
            // ordinary one keeps its transformed bounds.
            $end = $result['deleted'] ? $result['start'] : $result['end'];

            $reading->update([
                'start_offset' => $result['start'],
                'end_offset' => $end,
                'needs_review' => $result['deleted'] ? true : $result['needsReview'],
            ]);

            $after = mb_substr($newText, $result['start'], $end - $result['start']);

            // Only a change to the *words* is edition-visible; an edit
            // elsewhere that merely shifts this reading's offsets is not.
            if ($selectedBy !== [] && $before !== $after) {
                $affected = [...$affected, ...$selectedBy];
            }
        }

        return array_values(array_unique($affected));
    }

    /**
     * Edition titles keyed by the id of the reading they print, for just
     * these readings — the one thing that decides whether an edit to a
     * witness is visible to a reader at all.
     *
     * @param  SupportCollection<int, LemmaReading>  $readings
     * @return array<int, list<string>>
     */
    private function selectingEditions(SupportCollection $readings): array
    {
        return EditionLemma::query()
            ->whereIn('selected_reading_id', $readings->map(fn (LemmaReading $reading): int => $reading->id)->all())
            ->with('edition:id,title')
            ->get()
            ->groupBy('selected_reading_id')
            ->map(fn (SupportCollection $selections) => array_values(array_unique(
                $selections->map(fn (EditionLemma $selection): string => $selection->edition->title)->all()
            )))
            ->all();
    }

    /**
     * @param  list<string>  $titles
     */
    private function editionReport(array $titles): string
    {
        $subject = count($titles) === 1
            ? 'the edition “'.$titles[0].'”'
            : 'the editions '.collect($titles)->map(fn (string $title) => '“'.$title.'”')->join(', ', ' and ');

        return 'This also changed the printed wording of '.$subject.', which prints these words.';
    }
}
