<?php

namespace App\Http\Requests;

use App\Models\Edition;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ApplyEditionOrderCandidateRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Apply one order-report candidate to its range. Exactly one source:
     * a witness's own sequence (`transcription_layer_id`), a catalogued
     * Reordering/Transposition conjecture (`conjecture_id`), or — with
     * neither — plain citation order. Whether the source actually orders
     * exactly this range is re-derived server-side, never trusted from the
     * client (see EditionOrderController::candidateSequence).
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Edition $edition */
        $edition = $this->route('edition');

        return [
            'range_start_canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'range_end_canonical_passage_id' => ['required', Rule::exists('edition_passages', 'canonical_passage_id')->where('edition_id', $edition->id)],
            'transcription_layer_id' => ['nullable', Rule::exists('transcription_layers', 'id'), 'prohibits:conjecture_id'],
            'conjecture_id' => ['nullable', Rule::exists('conjectures', 'id')],
        ];
    }
}
