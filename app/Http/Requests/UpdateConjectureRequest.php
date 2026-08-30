<?php

namespace App\Http\Requests;

use App\Support\Edition\ConjectureValidationRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateConjectureRequest extends FormRequest
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
        $structural = ConjectureValidationRules::structuralRules('');

        return [
            ...array_map(fn (array $rule) => ['sometimes', ...$rule], $structural),
            'transposition_range_end_canonical_passage_id' => ['sometimes', 'nullable', Rule::exists('canonical_passages', 'id')],
            'move_target_canonical_passage_id' => ['sometimes', 'nullable', Rule::exists('canonical_passages', 'id')],
            'move_position' => ['sometimes', 'nullable', Rule::in(['before', 'after'])],
            'proposed_by' => ['sometimes', 'nullable', 'string', 'max:255'],
            'bibliography' => ['sometimes', 'nullable', 'string'],
            'note' => ['sometimes', 'nullable', 'string'],
        ];
    }
}
