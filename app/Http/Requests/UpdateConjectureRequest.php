<?php

namespace App\Http\Requests;

use App\Models\Conjecture;
use App\Support\Edition\ConjectureShape;
use App\Support\Edition\ConjectureValidationRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateConjectureRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Conjecture $conjecture */
        $conjecture = $this->route('conjecture');

        return $this->user()->can('update', $conjecture);
    }

    /**
     * Every field of a conjecture may change, of whatever kind — the Work
     * page edits them all. Fields are `sometimes`: the edition page's
     * attribution editor sends `proposed_by` alone. The record is judged
     * as it would stand after the edit (ConjectureShape::merged), and its
     * kind cannot change while it is placed, adopted or filled.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Conjecture $conjecture */
        $conjecture = $this->route('conjecture');
        $work = $conjecture->canonicalPassage->work;
        $structural = ConjectureValidationRules::structuralRules('');

        return [
            ...array_map(fn (array $rule) => ['sometimes', ...$rule], $structural),
            ...array_map(fn (array $rule) => ['sometimes', ...$rule], ConjectureShape::orderingRules($work)),
            'canonical_passage_id' => ['sometimes', 'integer', Rule::exists('canonical_passages', 'id')->where('work_id', $work->id)],
            'proposed_by' => ['sometimes', 'nullable', 'string', 'max:255'],
            'note' => ['sometimes', 'nullable', 'string'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Conjecture $conjecture */
            $conjecture = $this->route('conjecture');

            ConjectureShape::check(
                $validator,
                ConjectureShape::merged($conjecture, $this->all()),
                $conjecture->canonicalPassage->work,
                $conjecture,
            );
        });
    }
}
