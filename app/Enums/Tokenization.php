<?php

namespace App\Enums;

/**
 * How a work's transcription text is divided into the tokens collation
 * aligns on (see App\Support\Transcription\Tokenizer).
 *
 * Collation needs a *token sequence*; whitespace is one implementation of
 * that, not the requirement itself. Greek and Latin get their tokens for free
 * from the spaces already in the text, but scripts that don't mark word
 * boundaries orthographically — Devanagari for Sanskrit, say — don't, and an
 * editor there would not want spaces inserted into the normalized text just
 * to satisfy the collator. This enum is the seam where such a script supplies
 * its boundaries another way.
 *
 * Only `Whitespace` is implemented so far. A second case should be added
 * together with its implementation, never ahead of it.
 */
enum Tokenization: string
{
    case Whitespace = 'whitespace';
}
