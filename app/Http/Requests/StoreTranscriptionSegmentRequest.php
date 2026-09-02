<?php

namespace App\Http\Requests;

use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTranscriptionSegmentRequest extends FormRequest
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
     * Marking a span always cites it at the same time — a span with no
     * citation would have no use to anyone, so there's no "assign later" step.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var TranscriptionLayer $transcription */
        $transcription = $this->route('transcription');

        return [
            'start_offset' => ['required', 'integer', 'min:0'],
            'end_offset' => [
                'required',
                'integer',
                'gt:start_offset',
                'max:'.mb_strlen($transcription->text),
            ],
            'work_id' => ['required', Rule::exists('works', 'id')],
            'label' => ['required', 'string', 'max:100'],
            // Only meaningful when the label names a passage this layer
            // already cites — the span becomes another *part* of it. See
            // TranscriptionSegmentController::store.
            'after_part' => ['nullable', 'integer', 'min:0'],
            'acknowledge_realignment' => ['nullable', 'boolean'],
        ];
    }
}
