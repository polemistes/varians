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
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return $this->user()->can('update', $edition);
    }

    /**
     * A note always names a segment of this edition's own work. `lemma_id`
     * optionally narrows it to one column of that segment, and
     * `range_end_lemma_id` widens that to a span — carrying a value only when
     * more than one column is genuinely covered, the same convention
     * LemmaReading uses. Omit both for a note about the segment as a whole,
     * which is what a speaker assignment usually is.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        $inSegment = fn () => Rule::exists('lemmas', 'id')
            ->where('segment_id', $this->input('segment_id'));

        return [
            'segment_id' => ['required', Rule::exists('segments', 'id')->where('work_id', $edition->work_id)],
            'lemma_id' => ['nullable', $inSegment()],
            'range_end_lemma_id' => ['nullable', $inSegment()],
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
