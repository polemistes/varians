<?php

namespace App\Http\Requests;

use App\Enums\ParatextKind;
use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

class StoreEditionParatextRequest extends FormRequest
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
     * A paratext stands before or after one column of a segment of this
     * edition's own work — see App\Models\EditionParatext.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'segment_id' => ['required', Rule::exists('segments', 'id')->where('work_id', $edition->work_id)],
            'lemma_id' => ['required', Rule::exists('lemmas', 'id')->where('segment_id', $this->input('segment_id'))],
            'placement' => ['required', Rule::in(['before', 'after'])],
            'kind' => ['required', new Enum(ParatextKind::class)],
            'text' => ['required', 'string', 'max:2000'],
        ];
    }
}
