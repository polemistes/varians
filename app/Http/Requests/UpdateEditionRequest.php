<?php

namespace App\Http\Requests;

use App\Enums\Visibility;
use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

class UpdateEditionRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return $this->user()->can('update', $edition);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'title' => ['sometimes', 'string', 'max:255', Rule::unique('editions', 'title')->where('work_id', $edition->work_id)->ignore($edition->id)],
            'description' => ['sometimes', 'nullable', 'string'],
            'visibility' => ['sometimes', new Enum(Visibility::class)],
        ];
    }
}
