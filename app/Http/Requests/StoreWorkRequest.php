<?php

namespace App\Http\Requests;

use App\Models\Work;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreWorkRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        return $this->user()->can('create', Work::class);
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
            // What stands between this level and the one before it. The
            // client names a space or no separator by word ('space',
            // 'none'), since the trimming middleware would empty either;
            // WorkController::store turns them into the characters.
            'levels.*.separator' => ['nullable', 'string', 'max:5'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $levels = array_values((array) $this->input('levels', []));

            // Without a separator only the change of type says where one
            // level ends and the next begins (digits against letters), so
            // two levels of one type cannot run together.
            foreach ($levels as $index => $level) {
                if ($index === 0 || ! is_array($level) || ($level['separator'] ?? null) !== 'none') {
                    continue;
                }

                if (($levels[$index - 1]['type'] ?? null) === ($level['type'] ?? null)) {
                    $validator->errors()->add(
                        "levels.{$index}.separator",
                        'Two levels of the same kind need a separator between them — without one there is no telling where one ends and the next begins.',
                    );
                }
            }
        });
    }
}
