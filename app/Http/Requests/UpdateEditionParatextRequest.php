<?php

namespace App\Http\Requests;

use App\Enums\ParatextKind;
use App\Models\EditionParatext;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

class UpdateEditionParatextRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var EditionParatext $paratext */
        $paratext = $this->route('paratext');

        return $this->user()->can('update', $paratext->edition);
    }

    /**
     * The wording and the kind may change; the place may not — a paratext
     * somewhere else is a different paratext.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'text' => ['sometimes', 'required', 'string', 'max:2000'],
            'kind' => ['sometimes', new Enum(ParatextKind::class)],
        ];
    }
}
