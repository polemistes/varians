<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateWitnessRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The same fields registration takes — every one editable after the
     * fact. `sometimes` so a partial edit touches only what it sends.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'siglum' => ['sometimes', 'required', 'string', 'max:50'],
            'label' => ['sometimes', 'nullable', 'string', 'max:255'],
            'repository' => ['sometimes', 'nullable', 'string', 'max:255'],
            'shelfmark' => ['sometimes', 'nullable', 'string', 'max:255'],
            'date_text' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:65535'],
        ];
    }
}
