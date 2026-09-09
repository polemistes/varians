<?php

namespace App\Enums;

/**
 * Which face renders the app's serif text — the Greek-bearing surfaces:
 * edition text, transcript panes, serif headings. A per-user reading
 * preference chosen on the profile page; both faces are self-hosted with
 * full polytonic coverage, and only the chosen one is ever downloaded
 * (see resources/css/app.css).
 *
 * `EbGaramond` is the Garamond revival, whose Greek descends from the
 * grec-du-roi tradition — cursive, calligraphic, set slightly larger via
 * size-adjust since Garamond faces run small on the body. `Cardo` is an
 * upright Bembo-descended bookface made for classical scholarship.
 */
enum GreekFont: string
{
    case EbGaramond = 'eb-garamond';
    case Cardo = 'cardo';
}
