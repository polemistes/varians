<?php

namespace App\Rules;

use App\Support\TranscriptionMarkup\InvalidMarkupException;
use App\Support\TranscriptionMarkup\MarkupParser;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

class ValidTranscriptionMarkup implements ValidationRule
{
    /**
     * Run the validation rule.
     *
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            return;
        }

        try {
            MarkupParser::parse($value);
        } catch (InvalidMarkupException $e) {
            $fail($e->getMessage());
        }
    }
}
