<?php

namespace App\Support\Edition;

use App\Enums\Tokenization;
use App\Models\Assignment;
use App\Models\Segment;
use App\Models\TranscriptionLayer;
use App\Support\Transcription\Tokenizer;
use App\Support\Transcription\WordDivision;
use Illuminate\Support\Collection;
use WeakMap;

/**
 * Finds what a witness physically has where its normalized text reads
 * something — the diplomatic wording behind a collated reading.
 *
 * Collation runs on normalized transcriptions, so every reading in an
 * apparatus is regularized text. A reader wants to see through it: what does
 * the manuscript itself show at this word? The two layers are separate
 * transcriptions with separate offsets, and the normalized one may differ in
 * every character (accents, breathings, markup resolved), so there is no
 * mapping by position.
 *
 * There is a mapping by *token index*, though, and it holds whenever the two
 * layers divide the segment into the same number of words — which is the
 * ordinary case, since the normalized layer is made by copying the diplomatic
 * one and regularizing it in place. Where the counts differ (crasis resolved,
 * a word divided differently) no correspondence can be trusted, and this
 * returns null rather than guessing: showing the wrong manuscript reading
 * would be worse than showing none.
 *
 * A conjecture has no diplomatic counterpart at all — no manuscript attests
 * it — and callers should not ask for one.
 */
class DiplomaticCounterpart
{
    /** @var WeakMap<TranscriptionLayer, array<int, list<array{text: string, start: int, end: int}>|null>>|null */
    private static ?WeakMap $tokenCache = null;

    /**
     * The diplomatic wording for the tokens a normalized span covers, or null
     * if the layers cannot be lined up.
     *
     * @param  TranscriptionLayer  $normalized  the transcription the span belongs to
     * @param  TranscriptionLayer|null  $diplomatic  its witness's diplomatic layer, if the viewer may see one
     * @param  Tokenization  $tokenization  the work's own strategy — passed in rather than read off the segment, since one edition is one work
     */
    public static function forSpan(
        Segment $segment,
        TranscriptionLayer $normalized,
        ?TranscriptionLayer $diplomatic,
        int $start,
        int $end,
        Tokenization $tokenization,
    ): ?string {
        if ($diplomatic === null) {
            return null;
        }

        $normalizedTokens = self::tokens($segment, $normalized, $tokenization);
        $diplomaticTokens = self::tokens($segment, $diplomatic, $tokenization);

        // Same number of words, or no trustworthy correspondence.
        if ($normalizedTokens === null || $diplomaticTokens === null || count($normalizedTokens) !== count($diplomaticTokens)) {
            return null;
        }

        $covered = [];

        foreach ($normalizedTokens as $index => $token) {
            if ($token['start'] >= $start && $token['end'] <= $end) {
                $covered[] = $index;
            }
        }

        if ($covered === []) {
            return null;
        }

        $first = $diplomaticTokens[min($covered)];
        $last = $diplomaticTokens[max($covered)];

        // Sliced from the source rather than rejoined, so whatever stands
        // between the words — spacing, markup — survives as written; a word
        // divided at a line's end shows its division, "ἄνδ-|ρα".
        return WordDivision::asWritten($diplomatic->text, $first['start'], $last['end']);
    }

    /**
     * The whole segment as the manuscript has it, for reading the line rather
     * than one word of it.
     *
     * A segment assigned by several spans is physically discontinuous — a
     * transposition split it — so its parts are joined with an ellipsis
     * rather than run together, which would present as contiguous what the
     * manuscript does not have in one place.
     */
    public static function forSegment(Segment $segment, ?TranscriptionLayer $diplomatic): ?string
    {
        if ($diplomatic === null) {
            return null;
        }

        $assignments = self::assignments($segment, $diplomatic);

        return $assignments->isEmpty()
            ? null
            : $assignments
                ->map(fn (Assignment $assignment) => WordDivision::asWritten($diplomatic->text, $assignment->start_offset, $assignment->end_offset))
                ->join(' … ');
    }

    /**
     * The token stream of a layer's assignment — all its parts, concatenated
     * in content order, exactly as SegmentAligner consumes them. Both layers
     * go through this, so the token-index mapping holds whenever both divide
     * the segment into the same number of words, parts included; layers whose
     * parts split the text differently fail the count check as usual.
     *
     * @return list<array{text: string, start: int, end: int}>|null
     */
    private static function tokens(Segment $segment, TranscriptionLayer $transcription, Tokenization $tokenization): ?array
    {
        // Asked for every word and every candidate of a segment, and the
        // answer is the same each time: tokenized once per layer instance
        // and segment. Keyed by the model INSTANCE (a WeakMap), never by
        // id — a request's instances are its own, so nothing survives into
        // another request or test with a different text under the same id
        // (real incident: the edition page spent two thirds of its time
        // re-tokenizing the same lines).
        self::$tokenCache ??= new WeakMap;
        $cached = self::$tokenCache[$transcription] ?? [];

        if (array_key_exists($segment->id, $cached)) {
            return $cached[$segment->id];
        }

        $assignments = self::assignments($segment, $transcription);

        $tokens = $assignments->isEmpty()
            ? null
            : Tokenizer::tokenizeSpans(
                $transcription->text,
                array_values($assignments->map(fn (Assignment $assignment) => [
                    'start' => $assignment->start_offset,
                    'end' => $assignment->end_offset,
                ])->all()),
                $tokenization,
            );

        $cached[$segment->id] = $tokens;
        self::$tokenCache[$transcription] = $cached;

        return $tokens;
    }

    /**
     * This transcription's own assignment of the segment, every part of it, in
     * content order. Uses the loaded relation when there is one, so a caller
     * that eager-loaded assignments pays no query here.
     *
     * @return Collection<int, Assignment>
     */
    private static function assignments(Segment $segment, TranscriptionLayer $transcription): Collection
    {
        /** @var Collection<int, Assignment> $assignments */
        $assignments = $transcription->relationLoaded('assignments')
            ? $transcription->assignments
            : $transcription->assignments()->get();

        return Assignment::sortByPartOrder(
            $assignments->where('segment_id', $segment->id)
        );
    }
}
