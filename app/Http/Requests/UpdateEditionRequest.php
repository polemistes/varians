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
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'title' => ['sometimes', 'string', 'max:255', Rule::unique('editions', 'title')->where('work_id', $edition->work_id)->ignore($edition->id)],
            'description' => ['sometimes', 'nullable', 'string'],
            'visibility' => ['sometimes', new Enum(Visibility::class)],
        ];
    }
}
