<?php

namespace App\Http\Requests;

use App\Enums\ConjectureType;
use App\Models\Conjecture;
use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreEditionAdoptionRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Adopt a catalogued ordering proposal — a Reordering or Transposition
     * of this edition's work — wherever it is offered: the order panel, or
     * the split-citation report of a line the proposal divides.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'conjecture_id' => ['required', 'integer', Rule::exists('conjectures', 'id')],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Edition $edition */
            $edition = $this->route('edition');
            $conjecture = Conjecture::with('canonicalPassage:id,work_id')->find((int) $this->input('conjecture_id'));

            if ($conjecture === null) {
                return;
            }

            if ($conjecture->canonicalPassage->work_id !== $edition->work_id) {
                $validator->errors()->add('conjecture_id', 'That proposal belongs to another work.');
            } elseif (! in_array($conjecture->type, [ConjectureType::Reordering, ConjectureType::Transposition], true)) {
                $validator->errors()->add('conjecture_id', 'Only an ordering proposal is adopted this way — a reading is picked from its column.');
            }
        });
    }
}
