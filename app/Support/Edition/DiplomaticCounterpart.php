<?php

namespace App\Support\Edition;

use App\Enums\Tokenization;
use App\Models\CanonicalPassage;
use App\Models\Transcription;
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
     * @param  Transcription  $normalized  the transcription the span belongs to
     * @param  Transcription|null  $diplomatic  its witness's diplomatic layer, if the viewer may see one
     * @param  Tokenization  $tokenization  the work's own strategy — passed in rather than read off the passage, since one edition is one work
     */
    public static function forSpan(
        CanonicalPassage $passage,
        Transcription $normalized,
        ?Transcription $diplomatic,
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
     */
    public static function forPassage(CanonicalPassage $passage, ?Transcription $diplomatic): ?string
    {
        if ($diplomatic === null) {
            return null;
        }

        $segment = self::segment($passage, $diplomatic);

        return $segment === null
            ? null
            : mb_substr($diplomatic->text, $segment->start_offset, $segment->end_offset - $segment->start_offset);
    }

    /**
     * @return list<array{text: string, start: int, end: int}>|null
     */
    private static function tokens(CanonicalPassage $passage, Transcription $transcription, Tokenization $tokenization): ?array
    {
        $segment = self::segment($passage, $transcription);

        return $segment === null
            ? null
            : Tokenizer::tokenize(
                $transcription->text,
                $segment->start_offset,
                $segment->end_offset,
                $tokenization,
            );
    }

    /**
     * This transcription's own citation of the passage. Uses the loaded
     * relation when there is one, so a caller that eager-loaded segments pays
     * no query here.
     */
    private static function segment(CanonicalPassage $passage, Transcription $transcription): ?TranscriptionSegment
    {
        /** @var Collection<int, TranscriptionSegment> $segments */
        $segments = $transcription->relationLoaded('segments')
            ? $transcription->segments
            : $transcription->segments()->get();

        return $segments->firstWhere('canonical_passage_id', $passage->id);
    }
}
