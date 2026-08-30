<?php

namespace App\Enums;

enum Visibility: string
{
    case Published = 'published';
    case Draft = 'draft';
}
