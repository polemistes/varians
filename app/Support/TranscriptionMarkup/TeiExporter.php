<?php

namespace App\Support\TranscriptionMarkup;

/**
 * Renders parsed transcription markup as an inline TEI/EpiDoc XML fragment,
 * suitable for embedding inside a containing element (e.g. <l> or <ab>).
 */
class TeiExporter
{
    public static function toXmlFragment(string $text): string
    {
        return implode('', array_map(
            self::renderToken(...),
            MarkupParser::parse($text),
        ));
    }

    /**
     * @param  array{type: 'text', text: string}|array{type: 'supplied', text: string}|array{type: 'unclear', text: string}|array{type: 'gap', reason: 'lost'|'illegible', quantity: int|null}  $token
     */
    private static function renderToken(array $token): string
    {
        return match ($token['type']) {
            'text' => self::escape($token['text']),
            'supplied' => '<supplied reason="lost">'.self::escape($token['text']).'</supplied>',
            'unclear' => '<unclear>'.self::escape($token['text']).'</unclear>',
            'gap' => self::renderGap($token),
        };
    }

    /**
     * @param  array{type: 'gap', reason: 'lost'|'illegible', quantity: int|null}  $token
     */
    private static function renderGap(array $token): string
    {
        $attributes = 'reason="'.$token['reason'].'"';

        if ($token['quantity'] !== null) {
            $attributes .= ' quantity="'.$token['quantity'].'" unit="character"';
        }

        $gap = "<gap {$attributes}/>";

        return $token['reason'] === 'illegible' ? "<unclear>{$gap}</unclear>" : $gap;
    }

    private static function escape(string $text): string
    {
        return htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
