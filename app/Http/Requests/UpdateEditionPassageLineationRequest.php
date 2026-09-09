<?php

namespace App\Http\Requests;

use App\Models\EditionPassage;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateEditionPassageLineationRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var EditionPassage $editionPassage */
        $editionPassage = $this->route('editionPassage');

        return $this->user()->can('update', $editionPassage->edition);
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
