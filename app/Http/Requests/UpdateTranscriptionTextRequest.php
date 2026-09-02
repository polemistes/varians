<?php

namespace App\Http\Requests;

use App\Rules\ValidTranscriptionMarkup;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class UpdateTranscriptionTextRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * `ops` is the ordered log of exact edit operations applied while the
     * scholar was typing — see App\Support\Transcription\SpanTransformer and
     * TextOpApplier for how they're replayed. `ops.*.text` is nullable for the
     * same reason as UpdateTranscriptionRequest::text: the global
     * ConvertEmptyStringsToNull middleware turns a pure deletion's empty
     * string into null before validation runs.
     *
     * `text` is the client's own resulting text — checked against the
     * server's independent replay of `ops`, not trusted directly (see
     * TranscriptionTextController::update). It's "present" and "nullable"
     * rather than "required" for the same reason: a save that empties the
     * transcription entirely is valid, and ConvertEmptyStringsToNull turns
     * that empty string into null before validation runs.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'ops' => ['present', 'array'],
            'ops.*.start' => ['required', 'integer', 'min:0'],
            'ops.*.end' => ['required', 'integer', 'min:0'],
            'ops.*.text' => ['present', 'nullable', 'string'],
            // Pairs one deletion (the cut) with one later insertion of the
            // same text (its paste) so spans inside the cut travel with it.
            // The pairing claim itself is verified in
            // TranscriptionTextController::normalizeOps, not here.
            'ops.*.cut_id' => ['sometimes', 'nullable', 'string', 'max:64'],
            'text' => ['present', 'nullable', 'string', new ValidTranscriptionMarkup],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach ($this->input('ops', []) as $index => $op) {
                if (isset($op['start'], $op['end']) && is_int($op['start']) && is_int($op['end']) && $op['end'] < $op['start']) {
                    $validator->errors()->add("ops.{$index}.end", 'An operation\'s end cannot come before its start.');
                }
            }
        });
    }
}
