<?php

namespace App\Enums;

enum WitnessType: string
{
    case Manuscript = 'manuscript';
    case ApparatusReconstruction = 'apparatus_reconstruction';
    case PrintedEdition = 'printed_edition';
}
