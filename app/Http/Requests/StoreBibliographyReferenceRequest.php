<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Models\EditionPassage;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBibliographyReferenceRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * One citation of an item by exactly one thing: a conjecture, or a
     * passage of an edition (which must be in that edition). `prenote` and
     * `postnote` are biblatex's `\cite[pre][post]` — "cf." and the locator.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'bibliography_item_id' => ['required', 'integer', Rule::exists('bibliography_items', 'id')],
            'conjecture_id' => ['nullable', 'integer', Rule::exists('conjectures', 'id')],
            'edition_id' => ['nullable', 'integer', Rule::exists('editions', 'id')],
            'canonical_passage_id' => ['nullable', 'integer', Rule::exists('canonical_passages', 'id')],
            'prenote' => ['nullable', 'string', 'max:255'],
            'postnote' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $onConjecture = $this->filled('conjecture_id');
            $onPassage = $this->filled('edition_id') || $this->filled('canonical_passage_id');

            if ($onConjecture === $onPassage) {
                $validator->errors()->add('conjecture_id', 'A citation belongs to a conjecture or to a passage of an edition — exactly one.');

                return;
            }

            if ($onPassage) {
                if (! $this->filled('edition_id') || ! $this->filled('canonical_passage_id')) {
                    $validator->errors()->add('canonical_passage_id', 'A passage citation names both the edition and the passage.');

                    return;
                }

                $edition = Edition::find((int) $this->input('edition_id'));
                $inEdition = $edition !== null && EditionPassage::where('edition_id', $edition->id)
                    ->where('canonical_passage_id', (int) $this->input('canonical_passage_id'))
                    ->exists();

                if (! $inEdition) {
                    $validator->errors()->add('canonical_passage_id', 'That passage is not in this edition.');
                }
            }
        });
    }
}
