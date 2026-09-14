<?php

namespace App\Support\Edition;

use App\Models\Assignment;
use App\Models\EditionComment;
use App\Models\EditionLemma;
use App\Models\EditionLineBreak;
use App\Models\EditionParatext;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Support\Transcription\Tokenizer;
use App\Support\Transcription\WordDivision;
use Illuminate\Support\Collection;
use Normalizer;

/**
 * Grows a segment's shared, transcription-independent Lemma columns by
 * progressively aligning each witness's tokens into them — the same
 * technique behind collation tools like CollateX. A column (Lemma) is
 * anchored at one word, but a witness's own reading for it can span
 * *several* columns when its wording doesn't decompose word-for-word
 * against the existing ones (see `mergeSubstitutions()`) — e.g. one witness
 * has "τοσουτοι" where another has "το δε ειναι"; every witness that has a
 * token there gets a candidate LemmaReading, every witness that doesn't
 * simply has no reading there (absence is the gap, not an error — this is
 * how fragmentary witnesses are represented).
 *
 * The diff/merge plan (see `plan()`) is computed once by `alignWitness()`
 * and persisted as real Lemma/LemmaReading rows.
 */
class SegmentAligner
{
    /**
     * Collate a segment from every witness assigning text to it — the entry point
     * SegmentAdder uses, and the one that decides between rebuilding the
     * columns and appending to them.
     *
     * Aligning witnesses one at a time diffs each against a consensus the
     * ones already present have set, so the column structure depends on the
     * order they arrived. Ordering by siglum settles that for witnesses
     * present from the start, but not for one whose assignment appears after
     * the segment has already been collated and which sorts before the
     * witnesses that built it: appended, it never gets to seed the columns it
     * should have. So while a segment is still nothing but aligner output,
     * this throws the columns away and rebuilds from all witnesses at once.
     *
     * Once anything editorial is attached (see `hasEditorialContent`) it
     * appends instead. That is not a compromise but the right behaviour:
     * rebuilding would destroy placements and decisions that cannot be
     * re-derived from witness tokens, and a segment someone has begun editing
     * has a settled structure that should grow rather than churn.
     *
     * A layer may assign the segment with several spans — its text for the
     * segment is discontinuous, a transposition having split it — so the unit
     * of alignment is the *layer*, not the span: all of a layer's parts go to
     * `alignWitness` together, as one witness with one token stream.
     *
     * @param  Collection<int, Assignment>  $assignments  every normalized witness assignment assigning text to this segment
     */
    public static function collate(Segment $segment, Collection $assignments): void
    {
        // By siglum — the conventional order of an apparatus, and the only
        // key here derived from the evidence rather than from bookkeeping.
        // Not `transcription_layer_id`, which is merely creation order and would
        // make the collation depend on when each witness was typed up.
        $orderedLayers = $assignments
            ->groupBy('transcription_layer_id')
            ->sortBy(fn (Collection $layerAssignments) => [
                $layerAssignments->first()->transcriptionLayer->witness->siglum,
                $layerAssignments->first()->transcription_layer_id,
            ])
            ->values();

        if (! self::hasEditorialContent($segment)) {
            Lemma::where('segment_id', $segment->id)->delete();
        }

        foreach ($orderedLayers as $layerAssignments) {
            self::alignWitness($segment, $layerAssignments);
        }

        self::recordOmissions($segment);
    }

    /**
     * Record, for every witness aligned into a segment, where it *lacks*
     * columns the other witnesses attest — one zero-width `omitted` reading
     * per maximal run of such columns (see LemmaReading::$omitted), spanning
     * the run through `range_end_lemma_id` the way any wider reading does.
     *
     * Absence is thereby made a candidate: an edition can adopt B's omission
     * of two words and print nothing there, and the apparatus can name the
     * witnesses that omit a word beside those that have it. Columns no
     * witness attests at all (a lacuna's, or another conjecture-only column)
     * are nobody's omission and break a run rather than joining it — an
     * omission adopted across them would swallow the lacuna.
     *
     * The reading sits at the point in the witness's text where the missing
     * words would stand: the end of its last word before the run by column
     * order, or the start of its first word after it. That is where a
     * reader's click on the printed marker resolves to (see
     * EditionVariantController::resolveLemma) and what the facsimile
     * coupling is anchored on.
     *
     * Upserts by anchor column so an edition's selection of an omission
     * survives re-collation: an existing reading whose run still starts at
     * the same column is updated in place; one no longer wanted is deleted
     * unless an edition selects it — that decision is the editor's, not
     * the collator's, and stands until she changes it.
     */
    public static function recordOmissions(Segment $segment): void
    {
        $lemmas = Lemma::where('segment_id', $segment->id)
            ->orderBy('position')
            ->with('readings')
            ->get()
            ->values();

        if ($lemmas->isEmpty()) {
            return;
        }

        $indexOf = $lemmas->pluck('id')->flip();
        $attested = [];
        /** @var array<int, list<array{start: int, end: int, start_offset: int, end_offset: int}>> $spansByLayer */
        $spansByLayer = [];

        foreach ($lemmas as $index => $lemma) {
            foreach ($lemma->readings as $reading) {
                if ($reading->transcription_layer_id === null || $reading->omitted) {
                    continue;
                }

                $endIndex = $reading->range_end_lemma_id !== null
                    ? (int) ($indexOf[$reading->range_end_lemma_id] ?? $index)
                    : $index;

                for ($i = $index; $i <= $endIndex; $i++) {
                    $attested[$i] = true;
                }

                $spansByLayer[$reading->transcription_layer_id][] = [
                    'start' => $index,
                    'end' => $endIndex,
                    'start_offset' => (int) $reading->start_offset,
                    'end_offset' => (int) $reading->end_offset,
                ];
            }
        }

        $count = $lemmas->count();

        foreach ($spansByLayer as $layerId => $spans) {
            usort($spans, fn (array $a, array $b) => $a['start'] <=> $b['start']);
            $covered = [];

            foreach ($spans as $span) {
                for ($i = $span['start']; $i <= $span['end']; $i++) {
                    $covered[$i] = true;
                }
            }

            /** @var array<int, array{range_end_lemma_id: int|null, offset: int}> $desired */
            $desired = [];
            $i = 0;

            while ($i < $count) {
                if (! isset($attested[$i]) || isset($covered[$i])) {
                    $i++;

                    continue;
                }

                $runStart = $i;

                while ($i < $count && isset($attested[$i]) && ! isset($covered[$i])) {
                    $i++;
                }

                $runEnd = $i - 1;
                $before = null;
                $after = null;

                foreach ($spans as $span) {
                    if ($span['end'] < $runStart) {
                        $before = $span;
                    } elseif ($span['start'] > $runEnd && $after === null) {
                        $after = $span;
                    }
                }

                $desired[$lemmas[$runStart]->id] = [
                    'range_end_lemma_id' => $runEnd > $runStart ? $lemmas[$runEnd]->id : null,
                    'offset' => $before['end_offset'] ?? $after['start_offset'] ?? 0,
                ];
            }

            $existing = LemmaReading::whereIn('lemma_id', $lemmas->pluck('id'))
                ->where('transcription_layer_id', $layerId)
                ->where('omitted', true)
                ->get();
            $selectedIds = EditionLemma::whereIn('selected_reading_id', $existing->pluck('id'))
                ->pluck('selected_reading_id');

            foreach ($existing as $reading) {
                $want = $desired[$reading->lemma_id] ?? null;

                if ($want === null) {
                    if (! $selectedIds->contains($reading->id)) {
                        $reading->delete();
                    }

                    continue;
                }

                $reading->update([
                    'range_end_lemma_id' => $want['range_end_lemma_id'],
                    'start_offset' => $want['offset'],
                    'end_offset' => $want['offset'],
                ]);
                unset($desired[$reading->lemma_id]);
            }

            foreach ($desired as $lemmaId => $want) {
                LemmaReading::create([
                    'lemma_id' => $lemmaId,
                    'transcription_layer_id' => $layerId,
                    'start_offset' => $want['offset'],
                    'end_offset' => $want['offset'],
                    'range_end_lemma_id' => $want['range_end_lemma_id'],
                    'omitted' => true,
                ]);
            }
        }
    }

    /**
     * Whether anything on this segment's columns came from an editor rather
     * than from alignment, and so could not be reproduced by rebuilding.
     *
     * Two checks cover it. A reading carrying a `conjecture_id` is a
     * conjecture someone placed at a particular column, and that column is
     * the only record of the placement — which also covers lacuna columns,
     * since they exist solely to carry such a reading. An `EditionLemma` is
     * an edition's decision, and because every path through
     * EditionVariantController::store upserts one alongside whatever it
     * creates, this catches hand-placed *witness* readings too — otherwise
     * indistinguishable from aligner output, there being no provenance marker
     * on LemmaReading at all.
     *
     * A note anchored to a column counts as well (see EditionComment): an
     * editor who wrote about a particular word chose that column, and a
     * rebuild would move her argument under her. A note about the segment as
     * a whole anchors to nothing and so does not block anything. A line
     * break anchored to a column (EditionLineBreak — an edition's colometry)
     * counts for the same reason, and doubly so: its lemma FK cascades, so a
     * rebuild would not merely move the break but destroy it.
     */
    private static function hasEditorialContent(Segment $segment): bool
    {
        $lemmaIds = Lemma::where('segment_id', $segment->id)->pluck('id');

        if ($lemmaIds->isEmpty()) {
            return false;
        }

        return LemmaReading::whereIn('lemma_id', $lemmaIds)->whereNotNull('conjecture_id')->exists()
            || EditionLemma::whereIn('lemma_id', $lemmaIds)->exists()
            || EditionComment::whereIn('lemma_id', $lemmaIds)->exists()
            || EditionLineBreak::whereIn('lemma_id', $lemmaIds)->exists()
            || EditionParatext::whereIn('lemma_id', $lemmaIds)->exists();
    }

    /**
     * Align one witness layer into a segment's existing Lemma columns,
     * creating the columns from scratch if this is the first witness
     * touching the segment. Idempotent — a transcription that already has a
     * reading somewhere on this segment is left alone.
     *
     * Takes ALL of the layer's spans assigning text to the segment — several, when a
     * transposition left its text for the segment discontinuous — and
     * tokenizes them as one stream in part (content) order, NOT physical
     * order: what aligns against the other witnesses is what the layer's
     * text of the segment *reads as*, wherever its pieces physically sit.
     *
     * @param  Collection<int, Assignment>  $assignments  one layer's assignments of this segment
     */
    public static function alignWitness(Segment $segment, Collection $assignments): void
    {
        $assignments = Assignment::sortByPartOrder($assignments);
        $first = $assignments->first();

        if ($first === null) {
            return;
        }

        $layer = $first->transcriptionLayer;

        $lemmas = Lemma::where('segment_id', $segment->id)
            ->orderBy('position')
            ->with('readings.transcriptionLayer')
            ->get();

        // Tokenized part by part so the boundaries between parts are known:
        // a diff merge must never fuse tokens from different parts into one
        // reading, whose offsets would then span the physical gap between
        // them — or run backwards, when content order reverses physical.
        $tokens = [];
        $partStarts = [];

        foreach ($assignments as $assignment) {
            $partTokens = Tokenizer::tokenize(
                $layer->text,
                $assignment->start_offset,
                $assignment->end_offset,
                $segment->work->tokenization,
            );

            if ($tokens !== [] && $partTokens !== []) {
                $partStarts[] = count($tokens);
            }

            $tokens = [...$tokens, ...$partTokens];
        }
        $attributes = fn (array $token, ?int $rangeEndIndex = null): array => [
            'transcription_layer_id' => $layer->id,
            'start_offset' => $token['start'],
            'end_offset' => $token['end'],
            'range_end_lemma_id' => $rangeEndIndex !== null ? $lemmas[$rangeEndIndex]->id : null,
        ];

        if ($lemmas->isEmpty()) {
            $position = 1.0;

            foreach ($tokens as $token) {
                $lemma = Lemma::create(['segment_id' => $segment->id, 'position' => $position++]);
                $lemma->readings()->create($attributes($token));
            }

            return;
        }

        $alreadyAligned = LemmaReading::whereIn('lemma_id', $lemmas->pluck('id'))
            ->where('transcription_layer_id', $layer->id)
            ->exists();

        if ($alreadyAligned) {
            return;
        }

        $consensusTexts = $lemmas->map(fn (Lemma $lemma) => self::representativeText($lemma))->values()->all();
        $plan = self::withPositions(self::plan($consensusTexts, $tokens, $layer->text, $partStarts), $lemmas);

        foreach ($plan as $entry) {
            $index = $entry['index'];
            $token = $entry['token'];

            if ($entry['kind'] === 'existing') {
                if ($token !== null && is_int($index)) {
                    $lemmas[$index]->readings()->create($attributes($token, $entry['range_end_index'] ?? null));
                }

                continue;
            }

            if (! is_array($token)) {
                continue;
            }

            $lemma = Lemma::create(['segment_id' => $segment->id, 'position' => $entry['position']]);
            $lemma->readings()->create($attributes($token));
        }
    }

    /**
     * Re-align one layer whose assignment of a segment changed after it was
     * collated — a new part arrived, so its existing readings no longer cover
     * its text of the segment. Deletes exactly that layer's readings on the
     * segment's columns and aligns it afresh from all its current parts.
     *
     * Columns holding nothing but this layer's readings were this layer's own
     * contribution, so they go too and the re-alignment rebuilds them — left
     * standing empty, they would be diffed against as blank consensus text
     * and corrupt the new alignment.
     *
     * Declines (returns false, touching nothing) when any of those readings
     * is pinned: selected by an edition (`edition_lemmas.selected_reading_id`
     * is NOT NULL and cascades, so deleting would discard the decision, not
     * merely redo the alignment), carrying a conjecture placement, or on a
     * column an EditionComment is anchored to (the editor chose that column —
     * same rule as hasEditorialContent). The caller decides what to do with a
     * declined layer — flag it for review, never delete unilaterally.
     */
    public static function realignLayer(Segment $segment, TranscriptionLayer $layer): bool
    {
        $readings = self::layerReadings($segment, $layer);

        if (self::pinnedReadings($segment, $layer)->isNotEmpty()) {
            return false;
        }

        // "Another" reading includes conjecture-sourced ones, whose
        // transcription_layer_id is NULL — a bare `!=` would let SQL's null
        // comparison hide them and delete a column carrying a conjecture.
        // Another witness's omission reading is not "another reading" here:
        // it records the absence of a word, and a column standing on nothing
        // but absences is empty.
        $emptyingLemmaIds = Lemma::where('segment_id', $segment->id)
            ->whereDoesntHave('readings', fn ($query) => $query
                ->where('omitted', false)
                ->where(
                    fn ($other) => $other->whereNull('transcription_layer_id')->orWhere('transcription_layer_id', '!=', $layer->id)
                ))
            ->pluck('id');

        // An anchored note or a colometry break on a column this realignment
        // would empty out pins it — same rule as hasEditorialContent, and for
        // breaks the lemma FK cascades, so deletion would destroy them.
        if (EditionComment::whereIn('lemma_id', $emptyingLemmaIds)->exists()
            || EditionLineBreak::whereIn('lemma_id', $emptyingLemmaIds)->exists()
            || EditionParatext::whereIn('lemma_id', $emptyingLemmaIds)->exists()) {
            return false;
        }

        LemmaReading::whereIn('id', $readings->pluck('id'))->delete();
        Lemma::whereIn('id', $emptyingLemmaIds)->delete();

        self::alignWitness(
            $segment,
            Assignment::where('segment_id', $segment->id)
                ->where('transcription_layer_id', $layer->id)
                ->get(),
        );
        self::recordOmissions($segment);

        return true;
    }

    /**
     * Whether the layer's text of the segment holds words its collation
     * does not — a word typed into a witness after it was collated. An
     * edit that damages a reading is re-collated on that account
     * (TranscriptionTextController::applyReadings); an insertion between
     * two words damages nothing, and until this was asked the new word
     * was invisible to every edition and every apparatus (real defect,
     * 2026-09-14). Words are counted as the aligner tokenizes them; a word
     * only partly inside a reading counts as uncollated too, since its
     * reading's bounds are stale.
     */
    public static function hasUncollatedWords(Segment $segment, TranscriptionLayer $layer): bool
    {
        $readings = self::layerReadings($segment, $layer)
            ->filter(fn (LemmaReading $reading) => ! $reading->omitted && $reading->start_offset !== null);

        foreach (self::layerTokens($segment, $layer) as $token) {
            if (self::staleOrMissing(self::overlapping($readings, $token), $token)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The layer's readings a word overlaps. None: the word is uncollated.
     * One that stops short of the word: the word grew into it, and the
     * reading's bounds are stale. Several: they cover it between them —
     * words a relocation left abutting are not one word to be recollated.
     *
     * @param  Collection<int, LemmaReading>  $readings
     * @param  array{text: string, start: int, end: int}  $token
     * @return Collection<int, LemmaReading>
     */
    private static function overlapping(Collection $readings, array $token): Collection
    {
        return $readings
            ->filter(fn (LemmaReading $reading) => $reading->start_offset < $token['end'] && $reading->end_offset > $token['start'])
            ->values();
    }

    /**
     * @param  Collection<int, LemmaReading>  $overlapping
     * @param  array{text: string, start: int, end: int}  $token
     */
    private static function staleOrMissing(Collection $overlapping, array $token): bool
    {
        if ($overlapping->isEmpty()) {
            return true;
        }

        if ($overlapping->count() > 1) {
            return false;
        }

        $reading = $overlapping->first();

        return $reading->start_offset > $token['start'] || $reading->end_offset < $token['end'];
    }

    /**
     * Grow the layer's collation to the words it lacks, keeping every
     * reading it has — what a word typed into a collated witness calls
     * for, pinned or not: a reading is what editions choose and the
     * apparatus reports, and an insertion adds to the line, it never
     * unsays the rest of it (realignLayer, the rebuild, is for a layer
     * whose readings an edit destroyed).
     *
     * A reading a new word grew into is widened to the word (the reading's
     * bounds were stale). Each run of words no reading covers is matched,
     * word for word, against the columns that stand between its
     * neighbouring readings' columns: a word another witness has there
     * takes that column (the layer's omission on it goes, unless an
     * edition adopted the omission — then the word stands beside it), and
     * a word no witness has gets a column of its own, placed between its
     * neighbours as alignWitness places one. Omissions are re-derived at
     * the end, so every other witness now omits the new column.
     */
    public static function growLayer(Segment $segment, TranscriptionLayer $layer): void
    {
        $tokens = self::layerTokens($segment, $layer);

        if ($tokens === []) {
            return;
        }

        $readings = self::layerReadings($segment, $layer)
            ->filter(fn (LemmaReading $reading) => ! $reading->omitted && $reading->start_offset !== null)
            ->values();

        // Stale bounds first: a reading a word grew into — the one reading
        // the word touches, stopping short of it — takes the whole word.
        foreach ($tokens as $token) {
            $over = self::overlapping($readings, $token);

            if ($over->count() === 1 && self::staleOrMissing($over, $token)) {
                $reading = $over->first();
                $reading->update([
                    'start_offset' => min((int) $reading->start_offset, $token['start']),
                    'end_offset' => max((int) $reading->end_offset, $token['end']),
                ]);
            }
        }

        $lemmas = Lemma::where('segment_id', $segment->id)
            ->orderBy('position')
            ->with('readings.transcriptionLayer')
            ->get()
            ->values();
        $indexOf = $lemmas->pluck('id')->flip();

        // Each token's column span in the layer's collation, or null.
        /** @var list<array{start: int, end: int}|null> $columnOf */
        $columnOf = [];

        foreach ($tokens as $token) {
            $over = self::overlapping($readings, $token);
            $columnOf[] = $over->isEmpty() ? null : [
                'start' => $over->min(fn (LemmaReading $reading) => (int) $indexOf[$reading->lemma_id]),
                'end' => $over->max(fn (LemmaReading $reading) => (int) ($reading->range_end_lemma_id !== null ? $indexOf[$reading->range_end_lemma_id] : $indexOf[$reading->lemma_id])),
            ];
        }

        $count = count($tokens);
        $i = 0;

        while ($i < $count) {
            if ($columnOf[$i] !== null) {
                $i++;

                continue;
            }

            $gapStart = $i;

            while ($i < $count && $columnOf[$i] === null) {
                $i++;
            }

            $gapTokens = array_slice($tokens, $gapStart, $i - $gapStart);
            $previous = $gapStart > 0 ? $columnOf[$gapStart - 1]['end'] : -1;
            $next = $i < $count ? $columnOf[$i]['start'] : $lemmas->count();

            // The columns other witnesses have between the neighbours —
            // an inserted word may be one of theirs.
            $between = $lemmas->slice($previous + 1, max(0, $next - $previous - 1))->values();
            $ops = self::lcsOps(
                $between->map(fn (Lemma $lemma) => self::comparisonForm(self::representativeText($lemma)))->all(),
                array_map(fn (array $token) => self::comparisonForm($token['text']), $gapTokens),
            );

            $lastPosition = $previous >= 0 ? (float) $lemmas[$previous]->position : 0.0;
            $afterPosition = $next < $lemmas->count() ? (float) $lemmas[$next]->position : null;
            /** @var list<array{text: string, start: int, end: int}> $pending */
            $pending = [];

            foreach ($ops as $op) {
                if ($op['type'] === 'equal' && isset($op['a'], $op['b'])) {
                    $lemma = $between[$op['a']];
                    self::placeColumns($segment, $layer, $pending, $lastPosition, (float) $lemma->position);
                    $pending = [];
                    $lastPosition = (float) $lemma->position;
                    self::takeColumn($lemma, $layer, $gapTokens[$op['b']]);

                    continue;
                }

                if ($op['type'] === 'insert' && isset($op['b'])) {
                    $pending[] = $gapTokens[$op['b']];
                }
            }

            self::placeColumns($segment, $layer, $pending, $lastPosition, $afterPosition);
        }

        self::recordOmissions($segment);
    }

    /**
     * New columns for words no witness has, spaced evenly between the
     * positions of their neighbours — as withPositions spaces them; past
     * the last column they simply go on.
     *
     * @param  list<array{text: string, start: int, end: int}>  $tokens
     */
    private static function placeColumns(Segment $segment, TranscriptionLayer $layer, array $tokens, float $before, ?float $after): void
    {
        $span = count($tokens);

        if ($span === 0) {
            return;
        }

        $after ??= $before + $span + 1;
        $step = ($after - $before) / ($span + 1);

        foreach ($tokens as $k => $token) {
            $lemma = Lemma::create(['segment_id' => $segment->id, 'position' => $before + $step * ($k + 1)]);
            $lemma->readings()->create([
                'transcription_layer_id' => $layer->id,
                'start_offset' => $token['start'],
                'end_offset' => $token['end'],
            ]);
        }
    }

    /**
     * The layer's reading of a word on a column another witness built.
     * The layer's omission there (a point, possibly a range) goes, unless
     * an edition adopted it: a selection cascades, so the word then stands
     * beside the adopted omission for the editor to re-choose.
     *
     * @param  array{text: string, start: int, end: int}  $token
     */
    private static function takeColumn(Lemma $lemma, TranscriptionLayer $layer, array $token): void
    {
        $omissions = LemmaReading::where('lemma_id', $lemma->id)
            ->where('transcription_layer_id', $layer->id)
            ->where('omitted', true)
            ->get();
        $selectedIds = EditionLemma::whereIn('selected_reading_id', $omissions->pluck('id'))->pluck('selected_reading_id');

        foreach ($omissions as $omission) {
            if (! $selectedIds->contains($omission->id)) {
                $omission->delete();
            }
        }

        $lemma->readings()->create([
            'transcription_layer_id' => $layer->id,
            'start_offset' => $token['start'],
            'end_offset' => $token['end'],
        ]);
    }

    /**
     * The words of the layer's text of the segment, every part in content
     * order, as the aligner tokenizes them.
     *
     * @return list<array{text: string, start: int, end: int}>
     */
    private static function layerTokens(Segment $segment, TranscriptionLayer $layer): array
    {
        $assignments = Assignment::sortByPartOrder(
            Assignment::where('segment_id', $segment->id)->where('transcription_layer_id', $layer->id)->get(),
        );

        return Tokenizer::tokenizeSpans(
            $layer->text,
            array_values($assignments->map(fn (Assignment $assignment) => ['start' => (int) $assignment->start_offset, 'end' => (int) $assignment->end_offset])->all()),
            $segment->work->tokenization,
        );
    }

    /**
     * One layer's collated readings on one segment's columns — non-empty
     * exactly when the layer has already been aligned into the segment.
     *
     * @return Collection<int, LemmaReading>
     */
    public static function layerReadings(Segment $segment, TranscriptionLayer $layer): Collection
    {
        return LemmaReading::whereIn('lemma_id', Lemma::where('segment_id', $segment->id)->pluck('id'))
            ->where('transcription_layer_id', $layer->id)
            ->get()
            ->toBase();
    }

    /**
     * The subset of a layer's readings on a segment that `realignLayer` must
     * not delete: readings an edition selects (the selection cascades away
     * with the reading) or that carry a conjecture placement. Non-empty means
     * re-alignment is blocked for this layer.
     *
     * @return Collection<int, LemmaReading>
     */
    public static function pinnedReadings(Segment $segment, TranscriptionLayer $layer): Collection
    {
        $readings = self::layerReadings($segment, $layer);

        $selectedIds = EditionLemma::whereIn('selected_reading_id', $readings->pluck('id'))
            ->pluck('selected_reading_id');

        return $readings->filter(
            fn (LemmaReading $reading) => $reading->conjecture_id !== null || $selectedIds->contains($reading->id)
        )->values();
    }

    /**
     * The form a token is compared in — canonical composition, so that two
     * spellings which differ only in Unicode encoding count as the same word.
     *
     * This is the seam where any further comparison-only regularization
     * belongs (folding diacritics, say, to stop an accent-only difference
     * reading as a variant). Anything added here must leave the stored text
     * untouched: `Assignment`, `TranscriptionRegion` and
     * `LemmaReading` all index into it by character offset.
     */
    private static function comparisonForm(string $text): string
    {
        return Normalizer::normalize($text, Normalizer::FORM_C) ?: $text;
    }

    /**
     * The text a later witness gets diffed against for this column. Prefers
     * a plain (non-range) reading — once a column can also hold a *wider*
     * merged reading from some other witness (see class docblock), that one
     * must never leak in here as the "consensus," or the next witness would
     * be diffed against multiple words for what is structurally one column.
     */
    private static function representativeText(Lemma $lemma): string
    {
        // Ordered explicitly: `readings` is a bare hasMany with no ordering,
        // so an unsorted `first()` would take whatever the database happened
        // to return — leaving the consensus every later witness is diffed
        // against, and so the column structure itself, resting on storage
        // order. Sorting by transcription_layer_id matches the order readings are
        // created in today, but stops relying on that being true.
        $readings = $lemma->readings->sortBy('transcription_layer_id')->values();

        // An omission reading says the witness has *no* word here — never the
        // consensus, whose blank would make every later witness's word an
        // insertion.
        $readings = $readings->reject(fn (LemmaReading $reading) => $reading->omitted);

        $reading = $readings->first(fn (LemmaReading $reading) => $reading->transcription_layer_id !== null && $reading->range_end_lemma_id === null)
            ?? $readings->first(fn (LemmaReading $reading) => $reading->transcription_layer_id !== null);

        if ($reading === null) {
            return '';
        }

        return WordDivision::wordText($reading->transcriptionLayer->text, $reading->start_offset, $reading->end_offset);
    }

    /**
     * Build the ordered merge plan between the current consensus columns and
     * one witness's tokens — a word-level LCS diff (see `lcsOps`), reshaped
     * into a linear sequence of "goes into existing column i" / "opens a
     * brand new column" entries in final display order. Pure — no side
     * effects, so both the persisting and in-memory appliers share it.
     *
     * A run of deletes immediately touching a run of inserts (the LCS
     * encoding of a word — or several — being replaced by different ones)
     * is merged into *one* substitution into the existing column(s) rather
     * than left as separate deletes plus brand new columns — otherwise
     * "quick" → "slow" would render as two unrelated single-witness columns
     * instead of one variant site with two candidate readings, and (the
     * general case) "τοσουτοι" vs "το δε ειναι" would render as a fragment
     * plus phantom unfillable columns instead of one variant site with two
     * differently-worded candidates. See `mergeSubstitutions()`.
     *
     * No merge may span a part boundary (`$partStarts`): the tokens either
     * side of one come from physically separate spans, and one reading's
     * start/end offsets can only describe a contiguous stretch of source.
     *
     * @param  array<int, string>  $consensusTexts
     * @param  list<array{text: string, start: int, end: int}>  $tokens
     * @param  string  $sourceText  the witness's whole transcription text — needed to slice a merged multi-token span's exact source substring, never a rejoin
     * @param  list<int>  $partStarts  token indexes at which a later part of a discontinuous assignment begins
     * @return list<array<string, mixed>> each entry is {kind: string, index: int|null, token: array{text: string, start: int, end: int}|null, range_end_index: int|null}
     */
    private static function plan(array $consensusTexts, array $tokens, string $sourceText, array $partStarts = []): array
    {
        // Compared in a single Unicode form, never as typed. Greek can be
        // encoded precomposed or decomposed — ὲ as one code point or as
        // epsilon plus a combining varia — and the two are indistinguishable
        // on screen but unequal as strings. Without this, pasting one witness
        // from a source that uses the other encoding makes every word differ,
        // and the whole line collapses into a single spurious variant.
        //
        // Comparison only: what is stored, displayed and indexed by every
        // offset stays exactly as the editor typed it.
        $a = array_map(self::comparisonForm(...), $consensusTexts);
        $b = array_map(self::comparisonForm(...), array_map(fn (array $token) => $token['text'], $tokens));

        $ops = self::mergeSubstitutions(self::mergeTranspositions(self::lcsOps($a, $b), $a, $b, $partStarts), $partStarts);
        $entries = [];

        foreach ($ops as $op) {
            if ($op['type'] === 'equal' && isset($op['a'], $op['b'])) {
                $entries[] = ['kind' => 'existing', 'index' => $op['a'], 'token' => $tokens[$op['b']], 'range_end_index' => null];

                continue;
            }

            if ($op['type'] === 'substitute' && isset($op['a'], $op['b'])) {
                $bEnd = $op['b_end'] ?? $op['b'];
                $token = $bEnd === $op['b']
                    ? $tokens[$op['b']]
                    : [
                        'text' => WordDivision::wordText($sourceText, $tokens[$op['b']]['start'], $tokens[$bEnd]['end']),
                        'start' => $tokens[$op['b']]['start'],
                        'end' => $tokens[$bEnd]['end'],
                    ];

                $entries[] = ['kind' => 'existing', 'index' => $op['a'], 'token' => $token, 'range_end_index' => $op['a_end'] ?? null];

                continue;
            }

            if ($op['type'] === 'delete' && isset($op['a'])) {
                $entries[] = ['kind' => 'existing', 'index' => $op['a'], 'token' => null, 'range_end_index' => null];

                continue;
            }

            if (isset($op['b'])) {
                $entries[] = ['kind' => 'new', 'index' => null, 'token' => $tokens[$op['b']], 'range_end_index' => null];
            }
        }

        return $entries;
    }

    /**
     * Collapse a reordering into one variant site before substitutions are
     * merged.
     *
     * A word-order variant (*trajectio*) reaches `lcsOps` as a delete and an
     * insert of the *same* token with untouched words in between — "the swift
     * red fox" against "the red swift fox" deletes "swift" at one place and
     * inserts it at another. Left alone that yields two single-witness
     * columns, and the apparatus then reports one manuscript as *omitting* a
     * word and *adding* it again elsewhere, which is not what happened and is
     * not how a transposition is edited.
     *
     * The window from that delete to that insert is a pure reordering exactly
     * when the two witnesses' tokens across it are the same multiset in a
     * different order. It becomes one substitution spanning the whole window,
     * so the site reads "swift red] red swift B" — the same shape
     * `mergeSubstitutions` already gives an n:m substitution.
     *
     * The smallest qualifying window wins, so an unrelated later repetition of
     * a word cannot drag half a line into one site.
     *
     * @param  list<array{type: string, a: int|null, b: int|null}>  $ops
     * @param  array<int, string>  $aTexts
     * @param  list<string>  $bTexts
     * @param  list<int>  $partStarts
     * @return list<array{type: string, a: int|null, b: int|null, a_end?: int|null, b_end?: int|null}>
     */
    private static function mergeTranspositions(array $ops, array $aTexts, array $bTexts, array $partStarts = []): array
    {
        $result = [];
        $count = count($ops);
        $i = 0;

        while ($i < $count) {
            $window = $ops[$i]['type'] === 'delete'
                ? self::reorderingWindow($ops, $i, $aTexts, $bTexts, $partStarts)
                : null;

            if ($window === null) {
                $result[] = $ops[$i];
                $i++;

                continue;
            }

            $result[] = $window['op'];
            $i = $window['end'] + 1;
        }

        return $result;
    }

    /**
     * The shortest window starting at `$start` whose two sides carry the same
     * tokens in a different order, as a substitution op — or null if none
     * does.
     *
     * A window whose witness tokens straddle a part boundary never
     * qualifies — its substitution would claim one contiguous source span
     * that does not exist.
     *
     * @param  list<array{type: string, a: int|null, b: int|null}>  $ops
     * @param  array<int, string>  $aTexts
     * @param  list<string>  $bTexts
     * @param  list<int>  $partStarts
     * @return array{op: array{type: string, a: int|null, b: int|null, a_end: int|null, b_end: int|null}, end: int}|null
     */
    private static function reorderingWindow(array $ops, int $start, array $aTexts, array $bTexts, array $partStarts = []): ?array
    {
        $aIndexes = [];
        $bIndexes = [];

        for ($j = $start; $j < count($ops); $j++) {
            $op = $ops[$j];

            if ($op['a'] !== null) {
                $aIndexes[] = $op['a'];
            }

            if ($op['b'] !== null) {
                $bIndexes[] = $op['b'];
            }

            // Cheap precondition before the sort: the same multiset must have
            // the same size, which rules out most candidate windows outright.
            if ($op['type'] !== 'insert' || $aIndexes === [] || count($aIndexes) !== count($bIndexes)) {
                continue;
            }

            $aWords = array_map(fn (int $index) => $aTexts[$index], $aIndexes);
            $bWords = array_map(fn (int $index) => $bTexts[$index], $bIndexes);

            $aSorted = $aWords;
            $bSorted = $bWords;
            sort($aSorted);
            sort($bSorted);

            if ($aSorted !== $bSorted || $aWords === $bWords) {
                continue;
            }

            if (self::crossesPartBoundary($bIndexes[0], $bIndexes[count($bIndexes) - 1], $partStarts)) {
                continue;
            }

            return [
                'end' => $j,
                'op' => [
                    'type' => 'substitute',
                    'a' => $aIndexes[0],
                    'a_end' => count($aIndexes) > 1 ? $aIndexes[count($aIndexes) - 1] : null,
                    'b' => $bIndexes[0],
                    'b_end' => $bIndexes[count($bIndexes) - 1],
                ],
            ];
        }

        return null;
    }

    /**
     * A contiguous run of deletes immediately touching a contiguous run of
     * inserts becomes exactly ONE substitution, anchored at the *first*
     * deleted column and absorbing *every* inserted token as one merged
     * reading — not the old min(deletes,inserts) 1-for-1 pairing, which left
     * any excess as orphaned single-witness columns. Any additional deleted
     * columns beyond the first (`a_end` marks the last of them) simply get
     * no reading from this witness at that position — the same
     * "absence is the gap" semantics already used for a fragmentary
     * witness, not an error.
     *
     * Accepts ops that are already substitutions — mergeTranspositions runs
     * first and emits them — and passes those through untouched.
     *
     * An insert run straddling a part boundary is cut there: only the tokens
     * up to the boundary merge into the substitution (a merged reading's
     * offsets can only describe one contiguous source span), and the rest
     * stay plain inserts, opening their own columns.
     *
     * @param  list<array{type: string, a: int|null, b: int|null, a_end?: int|null, b_end?: int|null}>  $ops
     * @param  list<int>  $partStarts
     * @return list<array{type: string, a: int|null, b: int|null, a_end?: int|null, b_end?: int|null}>
     */
    private static function mergeSubstitutions(array $ops, array $partStarts = []): array
    {
        $result = [];
        $count = count($ops);
        $i = 0;

        while ($i < $count) {
            if ($ops[$i]['type'] !== 'delete') {
                $result[] = $ops[$i];
                $i++;

                continue;
            }

            $deleteStart = $i;

            while ($i < $count && $ops[$i]['type'] === 'delete') {
                $i++;
            }

            $insertStart = $i;

            while ($i < $count && $ops[$i]['type'] === 'insert') {
                $i++;
            }

            $deletes = array_slice($ops, $deleteStart, $insertStart - $deleteStart);
            $inserts = array_slice($ops, $insertStart, $i - $insertStart);

            if ($inserts === []) {
                foreach ($deletes as $delete) {
                    $result[] = $delete;
                }

                continue;
            }

            $merged = [];

            foreach ($inserts as $insert) {
                if ($merged !== [] && in_array($insert['b'], $partStarts, true)) {
                    break;
                }

                $merged[] = $insert;
            }

            $result[] = [
                'type' => 'substitute',
                'a' => $deletes[0]['a'],
                'a_end' => count($deletes) > 1 ? $deletes[count($deletes) - 1]['a'] : null,
                'b' => $merged[0]['b'],
                'b_end' => $merged[count($merged) - 1]['b'],
            ];

            for ($k = 1; $k < count($deletes); $k++) {
                $result[] = $deletes[$k];
            }

            foreach (array_slice($inserts, count($merged)) as $leftover) {
                $result[] = $leftover;
            }
        }

        return $result;
    }

    /**
     * Whether any part boundary falls strictly inside the witness-token span
     * `($from, $to]` — i.e. the span's tokens come from more than one part.
     *
     * @param  list<int>  $partStarts
     */
    private static function crossesPartBoundary(int $from, int $to, array $partStarts): bool
    {
        foreach ($partStarts as $boundary) {
            if ($boundary > $from && $boundary <= $to) {
                return true;
            }
        }

        return false;
    }

    /**
     * Assign a decimal `position` to every entry of a plan — existing
     * columns keep their Lemma's own position; runs of new columns are
     * spaced evenly between their resolved neighbours (mirroring the
     * midpoint-insertion technique used elsewhere in this feature).
     *
     * @param  list<array<string, mixed>>  $plan  each entry is {kind: string, index: int|null, token: mixed}
     * @param  Collection<int, Lemma>  $lemmas
     * @return list<array<string, mixed>> each entry additionally carries {position: float}
     */
    private static function withPositions(array $plan, Collection $lemmas): array
    {
        $count = count($plan);

        foreach ($plan as $i => $entry) {
            $index = $entry['index'];

            if ($entry['kind'] === 'existing' && is_int($index)) {
                $plan[$i]['position'] = (float) $lemmas[$index]->position;
            }
        }

        $i = 0;

        while ($i < $count) {
            if ($plan[$i]['kind'] !== 'new') {
                $i++;

                continue;
            }

            $runStart = $i;

            while ($i < $count && $plan[$i]['kind'] === 'new') {
                $i++;
            }

            $runEnd = $i;
            $span = $runEnd - $runStart;
            $before = $runStart > 0 ? (float) $plan[$runStart - 1]['position'] : 0.0;
            $after = $runEnd < $count ? (float) $plan[$runEnd]['position'] : $before + $span + 1;
            $step = ($after - $before) / ($span + 1);

            for ($k = $runStart; $k < $runEnd; $k++) {
                $plan[$k]['position'] = $before + $step * ($k - $runStart + 1);
            }
        }

        return $plan;
    }

    /**
     * Word-level LCS diff between two token-text sequences — a textbook
     * O(n×m) dynamic-programming alignment, well-scoped at this app's scale
     * (single segments, a handful of witnesses). Handles isolated word
     * substitution/insertion/deletion well; a full-line reorder degrades to
     * one large delete+insert run rather than failing.
     *
     * @param  array<int, string>  $a
     * @param  list<string>  $b
     * @return list<array{type: string, a: int|null, b: int|null}>
     */
    private static function lcsOps(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        $dp = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));

        for ($i = $n - 1; $i >= 0; $i--) {
            for ($j = $m - 1; $j >= 0; $j--) {
                $dp[$i][$j] = $a[$i] === $b[$j]
                    ? $dp[$i + 1][$j + 1] + 1
                    : max($dp[$i + 1][$j], $dp[$i][$j + 1]);
            }
        }

        $ops = [];
        $i = 0;
        $j = 0;

        while ($i < $n && $j < $m) {
            if ($a[$i] === $b[$j]) {
                $ops[] = ['type' => 'equal', 'a' => $i, 'b' => $j];
                $i++;
                $j++;
            } elseif ($dp[$i + 1][$j] >= $dp[$i][$j + 1]) {
                $ops[] = ['type' => 'delete', 'a' => $i, 'b' => null];
                $i++;
            } else {
                $ops[] = ['type' => 'insert', 'a' => null, 'b' => $j];
                $j++;
            }
        }

        while ($i < $n) {
            $ops[] = ['type' => 'delete', 'a' => $i, 'b' => null];
            $i++;
        }

        while ($j < $m) {
            $ops[] = ['type' => 'insert', 'a' => null, 'b' => $j];
            $j++;
        }

        return $ops;
    }
}
