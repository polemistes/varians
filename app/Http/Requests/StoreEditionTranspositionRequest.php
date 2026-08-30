<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Support\Edition\TranspositionValidator;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreEditionTranspositionRequest extends FormRequest
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
     * A transposition proposes moving `canonical_passage_id` — or, with
     * `transposition_range_end_canonical_passage_id`, that passage through
     * the given one, inclusive — to `move_position` ('before'/'after')
     * `move_target_canonical_passage_id`. This is an edition-ordering
     * proposal, not a word-level one: creating it here both records the
     * conjecture and adopts it for this edition in one step. Every
     * referenced passage must already be an EditionPassage of this edition
     * — a transposition about a passage not yet in the edition is
     * meaningless, since order is only ever established by adding.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'transposition_range_end_canonical_passage_id' => ['nullable', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'move_target_canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'move_position' => ['required', Rule::in(['before', 'after'])],
            'proposed_by' => ['nullable', 'string', 'max:255'],
            'bibliography' => ['nullable', 'string'],
            'note' => ['nullable', 'string'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var Edition $edition */
            $edition = $this->route('edition');

            $rangeStartId = $this->input('canonical_passage_id');

            if (! is_numeric($rangeStartId)) {
                return;
            }

            $rangeEndId = $this->input('transposition_range_end_canonical_passage_id');
            $targetId = $this->input('move_target_canonical_passage_id');

            TranspositionValidator::validate(
                $validator,
                $edition,
                (int) $rangeStartId,
                is_numeric($rangeEndId) ? (int) $rangeEndId : null,
                is_numeric($targetId) ? (int) $targetId : null,
                'transposition_range_end_canonical_passage_id',
                'move_target_canonical_passage_id',
            );
        });
    }
}
