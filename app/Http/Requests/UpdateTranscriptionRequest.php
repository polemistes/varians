<?php

namespace App\Http\Requests;

use App\Enums\Visibility;
use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

class UpdateTranscriptionRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var TranscriptionLayer $transcription */
        $transcription = $this->route('transcription');

        return $this->user()->can('update', $transcription);
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
            'visibility' => ['sometimes', new Enum(Visibility::class)],
        ];
    }
}
