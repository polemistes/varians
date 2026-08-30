<?php

namespace App\Http\Requests;

use App\Models\Edition;
use App\Models\EditionPassage;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreConjectureOrderingRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Authors a brand-new ConjectureType::Reordering proposing
     * `canonical_passage_ids` be read in exactly the given order — every id
     * must already be an EditionPassage of this edition, with no
     * duplicates, and together they must form one contiguous range of this
     * edition's own current position order (see withValidator). A
     * reordering conjecture's range, like a transposition's, only means
     * anything relative to the edition it was authored against; the
     * conjecture itself is then edition-independent, exactly like every
     * other Conjecture.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'canonical_passage_ids' => ['required', 'array', 'min:2'],
            'canonical_passage_ids.*' => ['distinct', 'integer', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
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
            $ids = $this->input('canonical_passage_ids');

            if (! is_array($ids) || $ids === []) {
                return;
            }

            $passages = EditionPassage::where('edition_id', $edition->id)
                ->whereIn('canonical_passage_id', $ids)
                ->get();

            if ($passages->count() !== count($ids)) {
                return; // already reported by the per-item exists rule
            }

            $minPosition = $passages->min('position');
            $maxPosition = $passages->max('position');

            $spanCount = EditionPassage::where('edition_id', $edition->id)
                ->where('position', '>=', $minPosition)
                ->where('position', '<=', $maxPosition)
                ->count();

            if ($spanCount !== count($ids)) {
                $validator->errors()->add('canonical_passage_ids', 'These passages must form one contiguous range in the edition\'s current order, with nothing left out.');
            }
        });
    }
}
