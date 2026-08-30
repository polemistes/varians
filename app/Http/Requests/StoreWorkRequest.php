<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreWorkRequest extends FormRequest
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
            'title' => ['required', 'string', 'max:255'],
            'author' => ['nullable', 'string', 'max:255'],
            'language' => ['required', 'string', 'max:20'],
            'slug' => ['required', 'string', 'max:255', 'alpha_dash', Rule::unique('works', 'slug')],
            'reference_scheme_id' => ['nullable', Rule::exists('reference_schemes', 'id')],
            'new_scheme_name' => ['required_without:reference_scheme_id', 'nullable', 'string', 'max:255'],
            'levels' => ['required_without:reference_scheme_id', 'nullable', 'array', 'min:1'],
            'levels.*.key' => ['required_with:levels', 'string', 'max:50', 'regex:/^[a-z_]+$/'],
            'levels.*.label' => ['required_with:levels', 'string', 'max:50'],
            'levels.*.type' => ['required_with:levels', Rule::in(['integer', 'string'])],
            'levels.*.separator' => ['nullable', 'string', 'max:5'],
        ];
    }
}
