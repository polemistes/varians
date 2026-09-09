<?php

namespace App\Http\Requests;

use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class DestroyEditionPassagesRequest extends FormRequest
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
     * The passages a selection in the edition text touched — one or many
     * at a time (user decision), each named by its canonical passage.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'canonical_passage_ids' => ['required', 'array', 'min:1'],
            'canonical_passage_ids.*' => ['integer', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
        ];
    }
}
