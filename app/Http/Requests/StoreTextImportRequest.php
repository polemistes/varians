<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreTextImportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * A file, and nothing else: the layer it loads into is the route
     * parameter, and which work the text belongs to is not decided here — it
     * follows later, from the citations assigned to it.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'mimes:txt', 'max:5120'],
        ];
    }
}
