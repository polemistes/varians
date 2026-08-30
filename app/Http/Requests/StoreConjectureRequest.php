<?php

namespace App\Http\Requests;

use App\Enums\ConjectureType;
use App\Models\CanonicalPassage;
use App\Models\Conjecture;
use App\Support\Edition\ConjectureValidationRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

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
     * Get the validation rules that apply to the request.
     *
     * `type` defaults to a plain substitution — see App\Enums\ConjectureType.
     * A substitution or supplement needs `text`; a supplement needs to name
     * the lacuna it fills. Never a transposition or a reordering — both are
     * ordering proposals authored with their own dedicated endpoint
     * (`edition-transpositions.store` / `conjecture-orderings.store`), never
     * here — see `withValidator`.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...ConjectureValidationRules::structuralRules(''),
            'proposed_by' => ['nullable', 'string', 'max:255'],
            'bibliography' => ['nullable', 'string'],
            'note' => ['nullable', 'string'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var CanonicalPassage $canonicalPassage */
            $canonicalPassage = $this->route('canonicalPassage');
            $type = $this->input('type') ?? ConjectureType::Substitution->value;

            if (in_array($type, [ConjectureType::Substitution->value, ConjectureType::Supplement->value], true) && ! $this->filled('text')) {
                $validator->errors()->add('text', 'This needs proposed text.');
            }

            if ($type === ConjectureType::Lacuna->value && $this->filled('text')) {
                $validator->errors()->add('text', 'A lacuna never carries its own text — propose a supplement instead.');
            }

            if ($type === ConjectureType::Supplement->value) {
                $lacunaId = $this->input('supplements_conjecture_id');

                if (! is_numeric($lacunaId)) {
                    $validator->errors()->add('supplements_conjecture_id', 'A supplement needs to name which lacuna it fills.');
                } else {
                    $lacuna = Conjecture::find((int) $lacunaId);

                    if ($lacuna !== null && $lacuna->canonical_passage_id !== $canonicalPassage->id) {
                        $validator->errors()->add('supplements_conjecture_id', 'That lacuna belongs to a different passage.');
                    }
                }
            }

            if ($type === ConjectureType::Transposition->value) {
                $validator->errors()->add('type', 'A transposition isn\'t recorded this way — see edition-transpositions.store.');
            }

            if ($type === ConjectureType::Reordering->value) {
                $validator->errors()->add('type', 'A reordering isn\'t recorded this way — see conjecture-orderings.store.');
            }
        });
    }
}
