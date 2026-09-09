<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Models\Work;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreEditionRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Work $work */
        $work = $this->route('work');

        return $this->user()->can('create', [Edition::class, $work]);
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
