<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreManuscriptPageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * A page is named and nothing more. Images arrive later, or never, and
     * where its text begins is recorded per layer as a page break.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'label' => ['required', 'string', 'max:50'],
        ];
    }
}
