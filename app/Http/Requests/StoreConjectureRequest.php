<?php

namespace App\Http\Requests;

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Support\Bibliography\ReferenceRules;
use App\Support\Edition\ConjectureShape;
use App\Support\Edition\ConjectureValidationRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class StoreConjectureRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Record a conjecture of any kind against a passage of the work — the
     * Work page's own list records every type as a catalogue entry, applied
     * to no edition (an edition follows an ordering proposal through
     * `edition-order.apply`, or records and follows a new one through
     * `conjecture-orderings.store`). `type` defaults to a plain substitution; what each
     * type must carry is ConjectureShape's matrix.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var CanonicalPassage $canonicalPassage */
        $canonicalPassage = $this->route('canonicalPassage');

        return [
            ...ConjectureValidationRules::structuralRules(''),
            ...ConjectureShape::orderingRules($canonicalPassage->work),
            'proposed_by' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string'],
            ...ReferenceRules::rules('references'),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var CanonicalPassage $canonicalPassage */
            $canonicalPassage = $this->route('canonicalPassage');

            ConjectureShape::check($validator, [
                ...$this->all(),
                'type' => $this->input('type') ?? ConjectureType::Substitution->value,
                'canonical_passage_id' => $canonicalPassage->id,
            ], $canonicalPassage->work);
        });
    }
}
