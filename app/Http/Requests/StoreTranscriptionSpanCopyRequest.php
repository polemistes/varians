<?php

namespace App\Http\Requests;

use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTranscriptionSpanCopyRequest extends FormRequest
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
