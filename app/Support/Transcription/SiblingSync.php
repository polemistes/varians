<?php

namespace App\Support\Transcription;

use App\Models\TranscriptionLayer;

/**
 * Projects a span made in one layer onto its in-step sibling, so an
 * assignment or facsimile mapping is DONE ONCE and appears in both.
 *
 * Interim machinery: the agreed destination stores spans once per
 * transcript in word coordinates; until that migration, both layers carry
 * parallel rows kept identical in word terms by these projections. Only an
 * IN-STEP sibling is written to — when the word skeletons disagree, the
 * words a span should land on cannot be named, and writing anyway would
 * corrupt rather than help (the indicator shows the drift instead).
 */
class SiblingSync
{
    /** The sibling layer that can safely receive the same span, or null. */
    public static function inStepSibling(TranscriptionLayer $layer): ?TranscriptionLayer
    {
        $sibling = $layer->transcription->layers()
            ->whereKeyNot($layer->id)
            ->first();

        if ($sibling === null) {
            return null;
        }

        return LayerCorrespondence::divergence($layer->text, $sibling->text) === null
            ? $sibling
            : null;
    }

    /**
     * The sibling's character range for the same WORDS — for citation
     * segments, which are word-granular.
     *
     * @return array{0: int, 1: int}
     */
    public static function projectRange(TranscriptionLayer $from, TranscriptionLayer $to, int $start, int $end): array
    {
        [$fromWord, $toWord] = WordSpans::toWordRange($from->text, $start, $end);

        return WordSpans::toCharRange($to->text, $fromWord, $toWord);
    }

    /**
     * The sibling's character range through sub-word ANCHORS — for
     * facsimile mappings, which may cover single characters. Exact where
     * the spellings match, clamped where they differ.
     *
     * @return array{0: int, 1: int}
     */
    public static function projectAnchors(TranscriptionLayer $from, TranscriptionLayer $to, int $start, int $end): array
    {
        $startAnchor = WordSpans::startAnchor($from->text, $start);
        $endAnchor = WordSpans::endAnchor($from->text, $end);

        return [
            WordSpans::fromAnchor($to->text, $startAnchor['word'], $startAnchor['char']),
            WordSpans::fromAnchor($to->text, $endAnchor['word'], $endAnchor['char']),
        ];
    }
}
