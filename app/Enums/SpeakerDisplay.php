<?php

namespace App\Enums;

/**
 * How an edition sets its speaker indications (ParatextKind::Speaker) —
 * one choice for the whole edition, held on `editions.speaker_display`.
 *
 * - Inline: every indication among the words.
 * - LineStartMargin: an indication at the beginning of a printed line
 *   stands in the left margin; one in the midst of a line stays inline.
 * - OwnLine: the indication takes a line of its own at the left, pushing
 *   the text down; where it interrupts a line, the rest of that line goes
 *   on below, indented to where it broke off.
 * - OwnLineCentered: the same, the indication centred.
 */
enum SpeakerDisplay: string
{
    case Inline = 'inline';
    case LineStartMargin = 'line_start_margin';
    case OwnLine = 'own_line';
    case OwnLineCentered = 'own_line_centered';
}
