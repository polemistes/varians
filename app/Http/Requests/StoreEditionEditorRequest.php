<?php

namespace App\Http\Requests;

use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreEditionEditorRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return $this->user()->can('manageEditors', $edition);
    }

    /**
     * A member is named by the address she registered with — exact, since
     * a grant is a deliberate act and a guess at a name must not land on
     * the wrong person.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'exists:users,email'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'email.exists' => 'No member is registered with that address.',
        ];
    }
}
