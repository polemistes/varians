<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTranscriptionSpanCopyRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'source_layer_id' => ['required', Rule::exists('transcription_layers', 'id')],
            'source_start' => ['required', 'integer', 'min:0'],
            'source_end' => ['required', 'integer', 'gt:source_start'],
            'target_offset' => ['required', 'integer', 'min:0'],
        ];
    }
}
