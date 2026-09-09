<?php

namespace App\Http\Requests;

use App\Enums\Layer;
use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreEditionPassageRequest extends FormRequest
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
     * Either the passages to add by id (`canonical_passage_ids` — the
     * witnesses pane names the segments a selection touched, whichever
     * layer it was made in) or a raw span of the layer's text, every
     * already-cited segment fully inside it (see
     * EditionPassageController::store). A selection covering only
     * already-added or uncited text isn't an error, just a no-op, so
     * there's no "at least one citable segment" rule here.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            // Only the normalized layer collates and only it may be a base —
            // see App\Enums\Layer.
            'transcription_layer_id' => ['required', Rule::exists('transcription_layers', 'id')->where('layer', Layer::Normalized->value)],
            'canonical_passage_ids' => ['nullable', 'array'],
            'canonical_passage_ids.*' => ['integer', Rule::exists('canonical_passages', 'id')],
            'start_offset' => ['required_without:canonical_passage_ids', 'integer', 'min:0'],
            'end_offset' => ['required_without:canonical_passage_ids', 'integer', 'gt:start_offset'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $transcriptionId = $this->input('transcription_layer_id');

            if (! is_numeric($transcriptionId)) {
                return;
            }

            $transcription = TranscriptionLayer::find((int) $transcriptionId);
            $endOffset = $this->input('end_offset');

            if ($transcription !== null && is_numeric($endOffset) && (int) $endOffset > mb_strlen($transcription->text)) {
                $validator->errors()->add('end_offset', 'That span reaches past the end of the transcription.');
            }
        });
    }
}
