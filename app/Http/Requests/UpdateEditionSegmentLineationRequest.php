<?php

namespace App\Http\Requests;

use App\Models\EditionSegment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateEditionSegmentLineationRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var EditionSegment $editionSegment */
        $editionSegment = $this->route('editionSegment');

        return $this->user()->can('update', $editionSegment->edition);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'starts_new_line' => ['required', 'boolean'],
            'starts_new_paragraph' => ['required', 'boolean'],
        ];
    }
}
