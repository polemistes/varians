<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Models\EditionSegment;
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
     * segment of an edition (which must be in that edition). `prenote` and
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
            'segment_id' => ['nullable', 'integer', Rule::exists('segments', 'id')],
            'prenote' => ['nullable', 'string', 'max:255'],
            'postnote' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $onConjecture = $this->filled('conjecture_id');
            $onSegment = $this->filled('edition_id') || $this->filled('segment_id');

            if ($onConjecture === $onSegment) {
                $validator->errors()->add('conjecture_id', 'A citation belongs to a conjecture or to a segment of an edition — exactly one.');

                return;
            }

            if ($onSegment) {
                if (! $this->filled('edition_id') || ! $this->filled('segment_id')) {
                    $validator->errors()->add('segment_id', 'A segment citation names both the edition and the segment.');

                    return;
                }

                $edition = Edition::find((int) $this->input('edition_id'));
                $inEdition = $edition !== null && EditionSegment::where('edition_id', $edition->id)
                    ->where('segment_id', (int) $this->input('segment_id'))
                    ->exists();

                if (! $inEdition) {
                    $validator->errors()->add('segment_id', 'That segment is not in this edition.');
                }
            }
        });
    }
}
