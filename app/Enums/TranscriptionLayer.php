<?php

namespace App\Enums;

/**
 * Which of a witness's two transcription layers this is.
 *
 * A witness is transcribed twice: `Diplomatic` records what the manuscript
 * physically has — original orthography, scribal spelling, Leiden markup for
 * what is lost or illegible, and the image-alignment regions, since only this
 * layer corresponds to marks on parchment. `Normalized` is the editor's own
 * regularization of it, and is the layer collation runs on.
 *
 * Only normalized transcriptions are collated (see
 * App\Support\Edition\PassageAdder) and only they may be an edition's base.
 * That is not a limitation imposed here but a requirement of collation
 * itself: a fully normalized witness cannot be meaningfully collated against
 * one that preserves accents, because every accent becomes a false variant.
 * The layer that collates must be normalized comparably across all witnesses.
 *
 * Note this deliberately reverses the earlier removal of a `type` column
 * (see the 2026_08_17_152742 migration), which dropped a *descriptive*
 * diplomatic/normalized distinction in favour of free-form tags. Tags remain
 * the better tool for description; `layer` exists because this distinction is
 * *structural* — it decides what enters the apparatus. Both can coexist.
 */
enum TranscriptionLayer: string
{
    case Diplomatic = 'diplomatic';
    case Normalized = 'normalized';
}
