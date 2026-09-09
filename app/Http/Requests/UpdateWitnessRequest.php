<?php

namespace App\Http\Requests;

use App\Models\Witness;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateWitnessRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Witness $witness */
        $witness = $this->route('witness');

        return $this->user()->can('update', $witness);
    }

    /**
     * The same fields registration takes — every one editable after the
     * fact. `sometimes` so a partial edit touches only what it sends.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'siglum' => ['sometimes', 'required', 'string', 'max:50'],
            'label' => ['sometimes', 'nullable', 'string', 'max:255'],
            'repository' => ['sometimes', 'nullable', 'string', 'max:255'],
            'shelfmark' => ['sometimes', 'nullable', 'string', 'max:255'],
            'date_text' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:65535'],
        ];
    }
}
