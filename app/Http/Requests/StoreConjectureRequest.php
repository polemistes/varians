<?php

namespace App\Http\Requests;

use App\Enums\ConjectureType;
use App\Models\Conjecture;
use App\Models\Segment;
use App\Support\Bibliography\ReferenceRules;
use App\Support\Edition\ConjectureShape;
use App\Support\Edition\ConjectureValidationRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class StoreConjectureRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Segment $segment */
        $segment = $this->route('segment');

        return $this->user()->can('create', [Conjecture::class, $segment]);
    }

    /**
     * Record a conjecture of any kind against a segment of the work — the
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
        /** @var Segment $segment */
        $segment = $this->route('segment');

        return [
            ...ConjectureValidationRules::structuralRules(''),
            ...ConjectureShape::orderingRules($segment->work),
            'proposed_by' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string'],
            ...ReferenceRules::rules('references'),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Segment $segment */
            $segment = $this->route('segment');

            ConjectureShape::check($validator, [
                ...$this->all(),
                'type' => $this->input('type') ?? ConjectureType::Substitution->value,
                'segment_id' => $segment->id,
            ], $segment->work);
        });
    }
}
