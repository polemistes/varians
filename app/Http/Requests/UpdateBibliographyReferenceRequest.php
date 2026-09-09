<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateBibliographyReferenceRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Only the notes change on a citation; citing a different item is a
     * different citation.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'prenote' => ['sometimes', 'nullable', 'string', 'max:255'],
            'postnote' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
