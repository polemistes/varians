<?php

namespace App\Http\Requests;

use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class DestroyTranscriptionRegionSpanRequest extends FormRequest
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
     * The span of the layer's text whose facsimile mappings go — "Remove
     * mapping of selection" on a selection that overlaps existing boxes.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'start_offset' => ['required', 'integer', 'min:0'],
            'end_offset' => ['required', 'integer', 'gt:start_offset'],
        ];
    }
}
