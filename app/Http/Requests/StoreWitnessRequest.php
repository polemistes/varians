<?php

namespace App\Http\Requests;

use App\Models\Witness;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreWitnessRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        return $this->user()->can('create', Witness::class);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'siglum' => ['required', 'string', 'max:50'],
            'label' => ['nullable', 'string', 'max:255'],
            'repository' => ['nullable', 'string', 'max:255'],
            'shelfmark' => ['nullable', 'string', 'max:255'],
            'date_text' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:65535'],
        ];
    }
}
