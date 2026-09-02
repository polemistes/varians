<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Models\EditionPassage;
use App\Models\Lemma;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateEditionLineBreakRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * A break stands before one collation column; `kind` null clears it —
     * the editor cycles line → paragraph → none on one endpoint.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'lemma_id' => ['required', Rule::exists('lemmas', 'id')],
            'kind' => ['present', 'nullable', Rule::in(['line', 'paragraph'])],
        ];
    }

    /**
     * The column must belong to a passage this edition actually contains —
     * colometry for text the edition doesn't print means nothing.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Edition $edition */
            $edition = $this->route('edition');
            $lemma = Lemma::find((int) $this->input('lemma_id'));

            if ($lemma === null) {
                return;
            }

            $inEdition = EditionPassage::where('edition_id', $edition->id)
                ->where('canonical_passage_id', $lemma->canonical_passage_id)
                ->exists();

            if (! $inEdition) {
                $validator->errors()->add('lemma_id', 'That column belongs to a passage this edition does not contain.');
            }
        });
    }
}
