<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Support\Edition\TranspositionValidator;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class MoveEditionPassagesRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * A cut-and-paste of the edition's own passages: move the contiguous
     * range from `range_start_canonical_passage_id` (through
     * `range_end_canonical_passage_id`, inclusive, when given) to
     * `move_position` of `target_canonical_passage_id`. Purely the editor's
     * own rearrangement — recording or applying a *proposal* goes through
     * edition-transpositions.store / edition-order.apply instead.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'range_start_canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'range_end_canonical_passage_id' => ['nullable', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'target_canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'move_position' => ['required', Rule::in(['before', 'after'])],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Edition $edition */
            $edition = $this->route('edition');

            $rangeStartId = $this->input('range_start_canonical_passage_id');

            if (! is_numeric($rangeStartId)) {
                return;
            }

            $rangeEndId = $this->input('range_end_canonical_passage_id');
            $targetId = $this->input('target_canonical_passage_id');

            TranspositionValidator::validate(
                $validator,
                $edition,
                (int) $rangeStartId,
                is_numeric($rangeEndId) ? (int) $rangeEndId : null,
                is_numeric($targetId) ? (int) $targetId : null,
                'range_end_canonical_passage_id',
                'target_canonical_passage_id',
            );
        });
    }
}
