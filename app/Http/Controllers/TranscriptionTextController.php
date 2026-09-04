<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateTranscriptionTextRequest;
use App\Models\EditionLemma;
use App\Models\LemmaReading;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionPageBreak;
use App\Models\TranscriptionRegion;
use App\Models\TranscriptionSegment;
use App\Support\Transcription\LayerMirror;
use App\Support\Transcription\RelocationSegmentEffects;
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
        [$affectedEditions, $mirroredTo] = DB::transaction(function () use ($request, $transcription): array {
            $original = $transcription->text;
            $ops = $this->normalizeOps($request->validated('ops'), $original);
            $recomputedText = TextOpApplier::applyAll($original, $ops);
            $submittedText = $request->validated('text') ?? '';

            if ($recomputedText !== $submittedText) {
                // Keyed 'ops', not 'text': the client tells a stale op log (a
                // concurrent edit — unrecoverable, stop autosaving and offer a
                // reload) apart from a 'text' validation failure (transiently
                // invalid markup mid-typing — keep the ops and retry).
                throw ValidationException::withMessages([
                    'ops' => 'This transcription changed since you started editing — reload and try again.',
                ]);
            }

            $this->applySpans($transcription->segments, $ops);
            $this->applySpans($transcription->regions, $ops, $recomputedText);
            $this->applyPageBreaks($transcription, $ops, $recomputedText);
            $affected = $this->applyReadings($transcription, $ops, $recomputedText);

            $transcription->update(['text' => $recomputedText]);

            $mirroredTo = $this->mirrorRelocations($transcription, $original, $ops, $affected);

            return [$affected, $mirroredTo];
        });

        $notices = [];

        if ($mirroredTo !== null) {
            $notices[] = $mirroredTo['relocated']
                ? 'Also moved the corresponding text in the '.$mirroredTo['layer'].' layer.'
                : 'Also applied the edit to the '.$mirroredTo['layer'].' layer.';
        }

        if ($affectedEditions !== []) {
            $notices[] = $this->editionReport(array_values(array_unique($affectedEditions)));
        }

        if ($notices !== []) {
            session()->flash('message', implode(' ', $notices));
        }

        return back();
    }

    /**
     * Replay this save's relocations on the sibling layer, so moving text
     * around in one layer moves the corresponding text in the other — the
     * two layers share a word skeleton (see LayerCorrespondence), and a
     * whole-word move means the same thing in either spelling.
     *
     * The mirrored ops run through the very same span pipeline, so the
     * sibling's citation segments, image regions and collation readings
     * travel exactly as this layer's did. Page breaks are deliberately NOT
     * reapplied: they live on the transcription in line coordinates, shared
     * by both layers, and this layer's pass already moved them — a second
     * pass would move them twice.
     *
     * @param  list<array{start: int, end: int, text: string, cut_id: string|null}>  $ops
     * @param  list<string>  $affected  edition titles, appended to in place
     * @return array{layer: string, relocated: bool}|null describes the mirror applied, if any
     */
    private function mirrorRelocations(TranscriptionLayer $transcription, string $originalText, array $ops, array &$affected): ?array
    {
        $sibling = $transcription->transcription->layers()
            ->whereKeyNot($transcription->id)
            ->first();

        if ($sibling === null || $sibling->text === '') {
            return null;
        }

        $mirror = LayerMirror::mirror($originalText, $ops, $sibling->text);

        if ($mirror === null) {
            return null;
        }

        $this->applySpans($sibling->segments, $mirror['ops']);
        $this->applySpans($sibling->regions, $mirror['ops'], $mirror['text']);
        $affected = [...$affected, ...$this->applyReadings($sibling, $mirror['ops'], $mirror['text'])];

        $sibling->update(['text' => $mirror['text']]);

        return ['layer' => $sibling->layer->value, 'relocated' => $mirror['relocated']];
    }

    /**
     * Normalize the raw op payload — and verify every cut/paste claim before
     * SpanTransformer honours it. A `cut_id` pairing one deletion with one
     * later insertion of *exactly* the deleted text makes spans inside the
     * cut travel with it (see SpanTransformer); the deleted text is
     * recomputed here by replaying the log against the stored text, so a
     * client cannot pair unrelated ops and teleport a citation onto words it
     * never covered. A malformed claim keeps its op but loses the id,
     * degrading to an ordinary edit (which tombstones rather than destroys).
     * A cut whose paste hasn't arrived in this save keeps its id — the
     * transformer degrades it to a deletion by itself.
     *
     * @param  list<array{start: mixed, end: mixed, text: mixed, cut_id?: mixed, atomic?: mixed}>  $ops
     * @return list<array{start: int, end: int, text: string, cut_id: string|null, atomic: bool}>
     */
    private function normalizeOps(array $ops, string $originalText): array
    {
        $normalized = array_map(fn (array $op) => [
            'start' => (int) $op['start'],
            'end' => (int) $op['end'],
            'text' => $op['text'] ?? '',
            'cut_id' => isset($op['cut_id']) && is_string($op['cut_id']) ? $op['cut_id'] : null,
            // Marked by the client for paste/import/undo/strip and
            // selection-wide deletions — the whole-word edits the sibling
            // layer mirrors verbatim. Typing is never atomic: the first
            // keystroke of a spelling change must stay in its own layer.
            'atomic' => (bool) ($op['atomic'] ?? false),
        ], $ops);

        $running = $originalText;
        $cutTexts = [];
        $pasted = [];

        foreach ($normalized as $index => $op) {
            if ($op['cut_id'] !== null) {
                $isCut = $op['text'] === '' && $op['end'] > $op['start'] && ! array_key_exists($op['cut_id'], $cutTexts);
                $isPaste = $op['text'] !== '' && $op['start'] === $op['end']
                    && array_key_exists($op['cut_id'], $cutTexts)
                    && ! isset($pasted[$op['cut_id']])
                    && $cutTexts[$op['cut_id']] === $op['text'];

                if ($isCut) {
                    $cutTexts[$op['cut_id']] = mb_substr($running, $op['start'], $op['end'] - $op['start']);
                } elseif ($isPaste) {
                    $pasted[$op['cut_id']] = true;
                } else {
                    $normalized[$index]['cut_id'] = null;
                }
            }

            $running = TextOpApplier::apply($running, $normalized[$index]);
        }

        return $normalized;
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
     * @param  list<array{start: int, end: int, text: string, cut_id?: string|null}>  $ops
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

        // A relocation's citation consequences beyond offset moves: a cut
        // FRAGMENT of a cited span becomes a new part of its own passage at
        // the paste site, and a span the paste lands inside SPLITS around
        // the arrival instead of absorbing it. Segments only — see
        // RelocationSegmentEffects.
        $effects = $spans->first() instanceof TranscriptionSegment
            ? RelocationSegmentEffects::plan(
                $spans->whereInstanceOf(TranscriptionSegment::class)->values(),
                $ops,
            )
            : ['overrides' => [], 'unflag' => [], 'creates' => []];

        $lostPartPassages = [];

        foreach ($spans as $index => $span) {
            $result = $transformed[$index];

            if (isset($effects['overrides'][$index])) {
                $override = $effects['overrides'][$index];
                $span->update([
                    'start_offset' => $override['start'],
                    'end_offset' => $override['end'],
                    'needs_review' => $override['needsReview'],
                ]);

                continue;
            }

            if ($result['deleted']) {
                // A destroyed citation span is kept as a zero-width, flagged
                // tombstone rather than deleted — an editor's assignment work
                // must never be destroyed by a text state that merely passed
                // through (an autosave can fire mid-rearrangement). Removing
                // it stays an explicit editor action. Regions are different:
                // they're re-drawable geometry nothing else references.
                if ($span instanceof TranscriptionSegment) {
                    $lostPartPassages[$span->canonical_passage_id] = true;

                    $span->update([
                        'start_offset' => $result['start'],
                        'end_offset' => $result['start'],
                        'needs_review' => true,
                    ]);

                    continue;
                }

                $span->delete();

                continue;
            }

            $attributes = [
                'start_offset' => $result['start'],
                'end_offset' => $result['end'],
                'needs_review' => in_array($index, $effects['unflag'], true)
                    ? false
                    : $result['needsReview'],
            ];

            if ($newText !== null && $span instanceof TranscriptionRegion) {
                $attributes['text'] = mb_substr($newText, $result['start'], $result['end'] - $result['start']);
            }

            $span->update($attributes);
        }

        // Rows the relocation calls into being: cut fragments carrying
        // their source's citation, and the right halves of split targets —
        // each placed in its passage's part order next to the span it came
        // from (see TranscriptionSegment::$part).
        foreach ($effects['creates'] as $create) {
            /** @var TranscriptionSegment $anchor */
            $anchor = $spans[$create['anchor_index']];
            $anchor->refresh();

            $siblings = TranscriptionSegment::where('transcription_layer_id', $anchor->transcription_layer_id)
                ->where('canonical_passage_id', $create['canonical_passage_id']);

            if ($create['placement'] === 'before') {
                $newPart = $anchor->part;
                $siblings->clone()->where('part', '>=', $newPart)->increment('part');
            } else {
                $newPart = $anchor->part + 1;
                $siblings->clone()->where('part', '>', $anchor->part)->increment('part');
            }

            TranscriptionSegment::create([
                'transcription_layer_id' => $anchor->transcription_layer_id,
                'canonical_passage_id' => $create['canonical_passage_id'],
                'start_offset' => $create['start'],
                'end_offset' => $create['end'],
                'part' => $newPart,
            ]);
        }

        // A destroyed segment may have been one *part* of a passage cited by
        // several spans; the survivors still stand, but the passage's witness
        // text just lost a piece and its collation for this layer is stale —
        // flag them so an editor re-confirms rather than trusting it silently.
        foreach ($spans as $span) {
            if ($span instanceof TranscriptionSegment
                && $span->exists
                && isset($lostPartPassages[$span->canonical_passage_id])
                && ! $span->needs_review) {
                $span->update(['needs_review' => true]);
            }
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
