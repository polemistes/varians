<?php

namespace App\Support\TranscriptionMarkup;

/**
 * Parses the Leiden-inspired inline transcription markup used in
 * TranscriptionSegment::$text. Deliberately narrow in scope — it covers only
 * the three things a diplomatic transcript needs to record about the state of
 * the text itself, not variants, apparatus, or citation structure:
 *
 *   [abc]  text lost, restored by the editor as "abc"
 *   [3]    text lost, ~3 characters, not restored
 *   [?]    text lost, extent unknown, not restored
 *   {3}    ink survives but is illegible, ~3 characters
 *   {?}    illegible, extent unknown
 *   _abc_  read as "abc", but the reading is uncertain
 *
 * Markup does not nest, and the reserved characters [ ] { } _ may not appear
 * as literal text outside of one of the forms above.
 */
class MarkupParser
{
    private const TOKEN_PATTERN = '/(\[[^\[\]]*\]|\{[^{}]*\}|_[^_]*_)/u';

    private const RESERVED_CHARS_PATTERN = '/[\[\]{}_]/u';

    /**
     * @return list<array{type: 'text', text: string}|array{type: 'supplied', text: string}|array{type: 'unclear', text: string}|array{type: 'gap', reason: 'lost'|'illegible', quantity: int|null}>
     *
     * @throws InvalidMarkupException
     */
    public static function parse(string $text): array
    {
        $parts = preg_split(self::TOKEN_PATTERN, $text, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [$text];
        $tokens = [];

        foreach ($parts as $index => $part) {
            if ($part === '') {
                continue;
            }

            if ($index % 2 === 1) {
                $tokens[] = self::classifyToken($part);

                continue;
            }

            self::assertNoReservedChars($part);
            $tokens[] = ['type' => 'text', 'text' => $part];
        }

        return $tokens;
    }

    public static function isValid(string $text): bool
    {
        try {
            self::parse($text);

            return true;
        } catch (InvalidMarkupException) {
            return false;
        }
    }

    /**
     * @return array{type: 'supplied', text: string}|array{type: 'unclear', text: string}|array{type: 'gap', reason: 'lost'|'illegible', quantity: int|null}
     */
    private static function classifyToken(string $token): array
    {
        $outer = $token[0];
        $inner = mb_substr($token, 1, mb_strlen($token) - 2);

        if ($outer === '_') {
            if ($inner === '') {
                throw new InvalidMarkupException('An uncertain reading "_..._" cannot be empty.');
            }

            self::assertNoReservedChars($inner);

            return ['type' => 'unclear', 'text' => $inner];
        }

        $reason = $outer === '[' ? 'lost' : 'illegible';

        if ($inner === '?') {
            return ['type' => 'gap', 'reason' => $reason, 'quantity' => null];
        }

        if ($inner !== '' && ctype_digit($inner)) {
            $quantity = (int) $inner;

            if ($quantity < 1) {
                throw new InvalidMarkupException('A gap\'s character count must be at least 1.');
            }

            return ['type' => 'gap', 'reason' => $reason, 'quantity' => $quantity];
        }

        if ($outer === '{') {
            throw new InvalidMarkupException('"{...}" must contain a number of characters or "?", e.g. "{3}" or "{?}" — illegible text has nothing to restore.');
        }

        if ($inner === '') {
            throw new InvalidMarkupException('"[...]" cannot be empty — use "[?]" if the extent of the loss is unknown.');
        }

        self::assertNoReservedChars($inner);

        return ['type' => 'supplied', 'text' => $inner];
    }

    private static function assertNoReservedChars(string $text): void
    {
        if (preg_match(self::RESERVED_CHARS_PATTERN, $text) === 1) {
            throw new InvalidMarkupException('Markup is unbalanced or malformed — check that every "[ ]", "{ }", and "_ _" pair is closed properly and not nested.');
        }
    }
}
