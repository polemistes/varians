<?php

namespace App\Http\Requests;

use App\Models\TranscriptionSegment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateTranscriptionSegmentRequest extends FormRequest
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
     * Re-drawing a span's boundaries (e.g. resolving a needs-review flag)
     * always resets needs_review — it's a live human confirmation.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var TranscriptionSegment $segment */
        $segment = $this->route('segment');

        return [
            'start_offset' => ['required', 'integer', 'min:0'],
            'end_offset' => [
                'required',
                'integer',
                'gt:start_offset',
                'max:'.mb_strlen($segment->transcriptionLayer->text),
            ],
        ];
    }
}
