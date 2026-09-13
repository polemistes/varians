<?php

namespace App\Http\Requests;

use App\Models\Assignment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateAssignmentRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Assignment $assignment */
        $assignment = $this->route('assignment');

        return $this->user()->can('update', $assignment->transcriptionLayer);
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
        /** @var Assignment $assignment */
        $assignment = $this->route('assignment');

        return [
            'start_offset' => ['required', 'integer', 'min:0'],
            'end_offset' => [
                'required',
                'integer',
                'gt:start_offset',
                'max:'.mb_strlen($assignment->transcriptionLayer->text),
            ],
        ];
    }
}
