<?php

namespace App\Http\Requests;

use App\Enums\Visibility;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

class UpdateTranscriptionRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * Text is not handled here — see transcriptions.text.update
     * (TranscriptionTextController) for the in-place editor's ops-log save.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'tags' => ['sometimes', 'array'],
            'tags.*' => ['string', 'max:50'],
            'visibility' => ['sometimes', new Enum(Visibility::class)],
        ];
    }
}
