<?php

namespace App\Http\Requests;

use App\Models\Work;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreEditionRequest extends FormRequest
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
        /** @var Work $work */
        $work = $this->route('work');

        return [
            'title' => ['required', 'string', 'max:255', Rule::unique('editions', 'title')->where('work_id', $work->id)],
            'description' => ['nullable', 'string'],
        ];
    }
}
