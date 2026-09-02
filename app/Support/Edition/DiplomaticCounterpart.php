<?php

namespace App\Support\Edition;

use App\Enums\Tokenization;
use App\Models\CanonicalPassage;
use App\Models\TranscriptionLayer;
use App\Models\TranscriptionSegment;
use App\Support\Transcription\Tokenizer;
use Illuminate\Support\Collection;

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
 * layers divide the passage into the same number of words — which is the
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
    /**
     * The diplomatic wording for the tokens a normalized span covers, or null
     * if the layers cannot be lined up.
     *
     * @param  TranscriptionLayer  $normalized  the transcription the span belongs to
     * @param  TranscriptionLayer|null  $diplomatic  its witness's diplomatic layer, if the viewer may see one
     * @param  Tokenization  $tokenization  the work's own strategy — passed in rather than read off the passage, since one edition is one work
     */
    public static function forSpan(
        CanonicalPassage $passage,
        TranscriptionLayer $normalized,
        ?TranscriptionLayer $diplomatic,
        int $start,
        int $end,
        Tokenization $tokenization,
    ): ?string {
        if ($diplomatic === null) {
            return null;
        }

        $normalizedTokens = self::tokens($passage, $normalized, $tokenization);
        $diplomaticTokens = self::tokens($passage, $diplomatic, $tokenization);

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
        // between the words — spacing, markup — survives as written.
        return mb_substr($diplomatic->text, $first['start'], $last['end'] - $first['start']);
    }

    /**
     * The whole passage as the manuscript has it, for reading the line rather
     * than one word of it.
     *
     * A passage cited by several spans is physically discontinuous — a
     * transposition split it — so its parts are joined with an ellipsis
     * rather than run together, which would present as contiguous what the
     * manuscript does not have in one place.
     */
    public static function forPassage(CanonicalPassage $passage, ?TranscriptionLayer $diplomatic): ?string
    {
        if ($diplomatic === null) {
            return null;
        }

        $segments = self::segments($passage, $diplomatic);

        return $segments->isEmpty()
            ? null
            : $segments
                ->map(fn (TranscriptionSegment $segment) => mb_substr($diplomatic->text, $segment->start_offset, $segment->end_offset - $segment->start_offset))
                ->join(' … ');
    }

    /**
     * The token stream of a layer's citation — all its parts, concatenated
     * in content order, exactly as PassageAligner consumes them. Both layers
     * go through this, so the token-index mapping holds whenever both divide
     * the passage into the same number of words, parts included; layers whose
     * parts split the text differently fail the count check as usual.
     *
     * @return list<array{text: string, start: int, end: int}>|null
     */
    private static function tokens(CanonicalPassage $passage, TranscriptionLayer $transcription, Tokenization $tokenization): ?array
    {
        $segments = self::segments($passage, $transcription);

        return $segments->isEmpty()
            ? null
            : Tokenizer::tokenizeSpans(
                $transcription->text,
                array_values($segments->map(fn (TranscriptionSegment $segment) => [
                    'start' => $segment->start_offset,
                    'end' => $segment->end_offset,
                ])->all()),
                $tokenization,
            );
    }

    /**
     * This transcription's own citation of the passage, every part of it, in
     * content order. Uses the loaded relation when there is one, so a caller
     * that eager-loaded segments pays no query here.
     *
     * @return Collection<int, TranscriptionSegment>
     */
    private static function segments(CanonicalPassage $passage, TranscriptionLayer $transcription): Collection
    {
        /** @var Collection<int, TranscriptionSegment> $segments */
        $segments = $transcription->relationLoaded('segments')
            ? $transcription->segments
            : $transcription->segments()->get();

        return TranscriptionSegment::sortByPartOrder(
            $segments->where('canonical_passage_id', $passage->id)
        );
    }
}
