<?php

namespace App\Http\Requests;

use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class DestroyEditionPassagesRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
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
