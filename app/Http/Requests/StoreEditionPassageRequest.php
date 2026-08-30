<?php

namespace App\Http\Requests;

use App\Models\Transcription;
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
     * A raw drag-selected span of a transcription's text — every already-
     * cited segment fully inside it gets added, in the transcription's own
     * physical order (see EditionPassageController::store). A selection
     * covering only already-added or uncited text isn't an error, just a
     * no-op, so there's no "at least one citable segment" rule here.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'transcription_id' => ['required', Rule::exists('transcriptions', 'id')],
            'start_offset' => ['required', 'integer', 'min:0'],
            'end_offset' => ['required', 'integer', 'gt:start_offset'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $transcriptionId = $this->input('transcription_id');

            if (! is_numeric($transcriptionId)) {
                return;
            }

            $transcription = Transcription::find((int) $transcriptionId);
            $endOffset = $this->input('end_offset');

            if ($transcription !== null && is_numeric($endOffset) && (int) $endOffset > mb_strlen($transcription->text)) {
                $validator->errors()->add('end_offset', 'That span reaches past the end of the transcription.');
            }
        });
    }
}
