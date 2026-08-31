<?php

namespace App\Support\Edition;

use App\Models\CanonicalPassage;
use App\Models\EditionLemma;
use App\Models\Lemma;
use App\Models\LemmaReading;
use App\Models\TranscriptionSegment;
use App\Support\Transcription\Tokenizer;
use Illuminate\Support\Collection;

/**
 * Grows a passage's shared, transcription-independent Lemma columns by
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
class PassageAligner
{
    /**
     * Collate a passage from every witness citing it — the entry point
     * PassageAdder uses, and the one that decides between rebuilding the
     * columns and appending to them.
     *
     * Aligning witnesses one at a time diffs each against a consensus the
     * ones already present have set, so the column structure depends on the
     * order they arrived. Ordering by siglum settles that for witnesses
     * present from the start, but not for one whose citation appears after
     * the passage has already been collated and which sorts before the
     * witnesses that built it: appended, it never gets to seed the columns it
     * should have. So while a passage is still nothing but aligner output,
     * this throws the columns away and rebuilds from all witnesses at once.
     *
     * Once anything editorial is attached (see `hasEditorialContent`) it
     * appends instead. That is not a compromise but the right behaviour:
     * rebuilding would destroy placements and decisions that cannot be
     * re-derived from witness tokens, and a passage someone has begun editing
     * has a settled structure that should grow rather than churn.
     *
     * @param  Collection<int, TranscriptionSegment>  $segments  every normalized witness segment citing this passage
     */
    public static function collate(CanonicalPassage $passage, Collection $segments): void
    {
        // By siglum — the conventional order of an apparatus, and the only
        // key here derived from the evidence rather than from bookkeeping.
        // Not `transcription_id`, which is merely creation order and would
        // make the collation depend on when each witness was typed up.
        $ordered = $segments
            ->sortBy(fn (TranscriptionSegment $segment) => [
                $segment->transcription->witness->siglum,
                $segment->transcription_id,
            ])
            ->values();

        if (! self::hasEditorialContent($passage)) {
            Lemma::where('canonical_passage_id', $passage->id)->delete();
        }

        foreach ($ordered as $segment) {
            self::alignWitness($passage, $segment);
        }
    }

    /**
     * Whether anything on this passage's columns came from an editor rather
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
     */
    private static function hasEditorialContent(CanonicalPassage $passage): bool
    {
        $lemmaIds = Lemma::where('canonical_passage_id', $passage->id)->pluck('id');

        if ($lemmaIds->isEmpty()) {
            return false;
        }

        return LemmaReading::whereIn('lemma_id', $lemmaIds)->whereNotNull('conjecture_id')->exists()
            || EditionLemma::whereIn('lemma_id', $lemmaIds)->exists();
    }

    /**
     * Align one witness's segment into a passage's existing Lemma columns,
     * creating the columns from scratch if this is the first witness
     * touching the passage. Idempotent — a transcription that already has a
     * reading somewhere on this passage is left alone.
     */
    public static function alignWitness(CanonicalPassage $passage, TranscriptionSegment $segment): void
    {
        $lemmas = Lemma::where('canonical_passage_id', $passage->id)
            ->orderBy('position')
            ->with('readings.transcription')
            ->get();

        $tokens = Tokenizer::tokenize(
            $segment->transcription->text,
            $segment->start_offset,
            $segment->end_offset,
            $passage->work->tokenization,
        );
        $attributes = fn (array $token, ?int $rangeEndIndex = null): array => [
            'transcription_id' => $segment->transcription_id,
            'start_offset' => $token['start'],
            'end_offset' => $token['end'],
            'range_end_lemma_id' => $rangeEndIndex !== null ? $lemmas[$rangeEndIndex]->id : null,
        ];

        if ($lemmas->isEmpty()) {
            $position = 1.0;

            foreach ($tokens as $token) {
                $lemma = Lemma::create(['canonical_passage_id' => $passage->id, 'position' => $position++]);
                $lemma->readings()->create($attributes($token));
            }

            return;
        }

        $alreadyAligned = LemmaReading::whereIn('lemma_id', $lemmas->pluck('id'))
            ->where('transcription_id', $segment->transcription_id)
            ->exists();

        if ($alreadyAligned) {
            return;
        }

        $consensusTexts = $lemmas->map(fn (Lemma $lemma) => self::representativeText($lemma))->values()->all();
        $plan = self::withPositions(self::plan($consensusTexts, $tokens, $segment->transcription->text), $lemmas);

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

            $lemma = Lemma::create(['canonical_passage_id' => $passage->id, 'position' => $entry['position']]);
            $lemma->readings()->create($attributes($token));
        }
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
        // order. Sorting by transcription_id matches the order readings are
        // created in today, but stops relying on that being true.
        $readings = $lemma->readings->sortBy('transcription_id')->values();

        $reading = $readings->first(fn (LemmaReading $reading) => $reading->transcription_id !== null && $reading->range_end_lemma_id === null)
            ?? $readings->first(fn (LemmaReading $reading) => $reading->transcription_id !== null);

        if ($reading === null) {
            return '';
        }

        return mb_substr($reading->transcription->text, $reading->start_offset, $reading->end_offset - $reading->start_offset);
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
     * @param  array<int, string>  $consensusTexts
     * @param  list<array{text: string, start: int, end: int}>  $tokens
     * @param  string  $sourceText  the witness's whole transcription text — needed to slice a merged multi-token span's exact source substring, never a rejoin
     * @return list<array<string, mixed>> each entry is {kind: string, index: int|null, token: array{text: string, start: int, end: int}|null, range_end_index: int|null}
     */
    private static function plan(array $consensusTexts, array $tokens, string $sourceText): array
    {
        $tokenTexts = array_map(fn (array $token) => $token['text'], $tokens);
        $ops = self::mergeSubstitutions(
            self::mergeTranspositions(self::lcsOps($consensusTexts, $tokenTexts), $consensusTexts, $tokenTexts)
        );
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
                        'text' => mb_substr($sourceText, $tokens[$op['b']]['start'], $tokens[$bEnd]['end'] - $tokens[$op['b']]['start']),
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
     * @return list<array{type: string, a: int|null, b: int|null, a_end?: int|null, b_end?: int|null}>
     */
    private static function mergeTranspositions(array $ops, array $aTexts, array $bTexts): array
    {
        $result = [];
        $count = count($ops);
        $i = 0;

        while ($i < $count) {
            $window = $ops[$i]['type'] === 'delete'
                ? self::reorderingWindow($ops, $i, $aTexts, $bTexts)
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
     * @param  list<array{type: string, a: int|null, b: int|null}>  $ops
     * @param  array<int, string>  $aTexts
     * @param  list<string>  $bTexts
     * @return array{op: array{type: string, a: int|null, b: int|null, a_end: int|null, b_end: int|null}, end: int}|null
     */
    private static function reorderingWindow(array $ops, int $start, array $aTexts, array $bTexts): ?array
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
     * @param  list<array{type: string, a: int|null, b: int|null, a_end?: int|null, b_end?: int|null}>  $ops
     * @return list<array{type: string, a: int|null, b: int|null, a_end?: int|null, b_end?: int|null}>
     */
    private static function mergeSubstitutions(array $ops): array
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

            $result[] = [
                'type' => 'substitute',
                'a' => $deletes[0]['a'],
                'a_end' => count($deletes) > 1 ? $deletes[count($deletes) - 1]['a'] : null,
                'b' => $inserts[0]['b'],
                'b_end' => $inserts[count($inserts) - 1]['b'],
            ];

            for ($k = 1; $k < count($deletes); $k++) {
                $result[] = $deletes[$k];
            }
        }

        return $result;
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
     * (single passages, a handful of witnesses). Handles isolated word
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
