<?php

namespace App\Support\Transcription;

use Normalizer;

/**
 * Deterministic regularizations of Greek text: removing what a scribe or an
 * editor may have added, never supplying what is absent.
 *
 * Everything here is reversible in principle and decidable without knowing
 * the language — decomposing a character and dropping named combining marks.
 * Deliberately absent is the opposite direction: *adding* correct accents and
 * breathings to text that lacks them needs morphological analysis against a
 * lexicon and stays ambiguous even then (τίς against τις, ἦ against ἥ). A
 * tool that got that silently wrong would be worse than no tool, because its
 * errors would read as scribal variants.
 *
 * The Leiden markup delimiters are never touched — see
 * App\Support\TranscriptionMarkup\MarkupParser. Stripping them would destroy
 * the record of what is lost or illegible, and would invalidate every
 * character offset recorded against the text besides.
 *
 * Mirrored in resources/js/lib/greekText.ts, which the editor uses to build
 * the same edit locally; keep the two in step.
 */
class GreekText
{
    /** Oxia, varia, perispomeni. */
    private const ACCENTS = ["\u{0301}", "\u{0300}", "\u{0342}"];

    /** Psili and dasia. */
    private const BREATHINGS = ["\u{0313}", "\u{0314}"];

    /**
     * Punctuation, excluding the markup delimiters. Listed rather than taken
     * from a Unicode class so that `[`, `]`, `{`, `}` and `_` cannot be
     * caught by widening the definition later.
     */
    private const PUNCTUATION = [
        ',', '.', ';', ':', '!', '?', '·', ';', '’', '‘', '“', '”', '"', "'",
        '(', ')', '«', '»', '—', '–', '-', '‹', '›', '…',
    ];

    public static function stripAccents(string $text): string
    {
        return self::without($text, self::ACCENTS);
    }

    public static function stripBreathings(string $text): string
    {
        return self::without($text, self::BREATHINGS);
    }

    /**
     * Every combining mark, accents and breathings alike, along with iota
     * subscript and diaeresis.
     */
    public static function stripDiacritics(string $text): string
    {
        $decomposed = Normalizer::normalize($text, Normalizer::FORM_D) ?: $text;

        return self::compose(preg_replace('/\p{Mn}+/u', '', $decomposed) ?? $decomposed);
    }

    public static function stripPunctuation(string $text): string
    {
        return self::compose(str_replace(self::PUNCTUATION, '', $text));
    }

    /**
     * The form two spellings are compared in when deciding whether they
     * differ only in orthography: diacritics, punctuation and case removed.
     * Two words equal under this but unequal as written differ in accent,
     * breathing or pointing alone.
     */
    public static function foldOrthography(string $text): string
    {
        return mb_strtolower(self::stripPunctuation(self::stripDiacritics($text)));
    }

    /**
     * @param  list<string>  $marks
     */
    private static function without(string $text, array $marks): string
    {
        $decomposed = Normalizer::normalize($text, Normalizer::FORM_D) ?: $text;

        return self::compose(str_replace($marks, '', $decomposed));
    }

    /**
     * Back to the composed form, so the result is encoded the way the rest of
     * the app compares text (see PassageAligner::comparisonForm).
     */
    private static function compose(string $text): string
    {
        return Normalizer::normalize($text, Normalizer::FORM_C) ?: $text;
    }
}
