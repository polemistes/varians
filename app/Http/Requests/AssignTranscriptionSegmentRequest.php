<?php

namespace App\Http\Requests;

use App\Models\TranscriptionSegment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignTranscriptionSegmentRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var TranscriptionSegment $segment */
        $segment = $this->route('segment');

        return $this->user()->can('update', $segment->transcriptionLayer);
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
