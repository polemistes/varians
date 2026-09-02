<?php

namespace App\Support\Transcription;

/**
 * Replays an ordered log of text-edit operations onto a string. Kept separate
 * from SpanTransformer (which transforms offsets, not text) so the server can
 * independently recompute the authoritative resulting text from its own stored
 * copy, rather than trusting whatever text a client submits alongside the ops.
 */
class TextOpApplier
{
    /**
     * @param  list<array{start: int, end: int, text: string}>  $ops
     */
    public static function applyAll(string $text, array $ops): string
    {
        foreach ($ops as $op) {
            $text = self::apply($text, $op);
        }

        return $text;
    }

    /**
     * @param  array{start: int, end: int, text: string}  $op
     */
    public static function apply(string $text, array $op): string
    {
        $chars = mb_str_split($text);
        $before = implode('', array_slice($chars, 0, $op['start']));
        $after = implode('', array_slice($chars, $op['end']));

        return $before.$op['text'].$after;
    }
}
