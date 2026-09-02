<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignTranscriptionSegmentRequest extends FormRequest
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
     * Re-cites an already-cited segment to a different passage — there's no
     * way to clear a segment's citation without removing the segment itself.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'work_id' => ['required', Rule::exists('works', 'id')],
            'label' => ['required', 'string', 'max:100'],
            // Only meaningful when the label names a passage this layer
            // already cites — the span becomes another *part* of it. See
            // TranscriptionSegmentController::assignCitation.
            'after_part' => ['nullable', 'integer', 'min:0'],
            'acknowledge_realignment' => ['nullable', 'boolean'],
        ];
    }
}
