<?php

namespace App\Http\Requests;

use App\Enums\WitnessType;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreWitnessRequest extends FormRequest
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
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'type' => ['required', Rule::enum(WitnessType::class)],
            'siglum' => ['required', 'string', 'max:50'],
            'label' => ['nullable', 'string', 'max:255'],
            'repository' => ['nullable', 'string', 'max:255'],
            'shelfmark' => ['nullable', 'string', 'max:255'],
            'date_text' => ['nullable', 'string', 'max:255'],
        ];
    }
}
