<?php

namespace App\Enums;

/**
 * Where a paratext is printed — see App\Models\EditionParatext.
 *
 * The margins hold a narrow box beside the line the paratext is anchored
 * in; Inline sets it among the words, in paratext style; Speaker is a
 * speaker's name in a dialogue, laid out by the edition's SpeakerDisplay.
 */
enum ParatextKind: string
{
    case LeftMargin = 'left_margin';
    case RightMargin = 'right_margin';
    case Inline = 'inline';
    case Speaker = 'speaker';
}
