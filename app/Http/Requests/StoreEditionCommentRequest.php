<?php

namespace App\Http\Requests;

use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreEditionCommentRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * A note always names a passage of this edition's own work. `lemma_id`
     * optionally narrows it to one column of that passage, and
     * `range_end_lemma_id` widens that to a span — carrying a value only when
     * more than one column is genuinely covered, the same convention
     * LemmaReading uses. Omit both for a note about the passage as a whole,
     * which is what a speaker assignment usually is.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        $inPassage = fn () => Rule::exists('lemmas', 'id')
            ->where('canonical_passage_id', $this->input('canonical_passage_id'));

        return [
            'canonical_passage_id' => ['required', Rule::exists('canonical_passages', 'id')->where('work_id', $edition->work_id)],
            'lemma_id' => ['nullable', $inPassage()],
            'range_end_lemma_id' => ['nullable', $inPassage()],
            'note' => ['required', 'string', 'max:5000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            // A range needs a column to start from; an end alone names nothing.
            if ($this->filled('range_end_lemma_id') && ! $this->filled('lemma_id')) {
                $validator->errors()->add('lemma_id', 'A range needs a starting column.');
            }
        });
    }
}
