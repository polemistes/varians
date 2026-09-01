<?php

namespace App\Http\Requests;

use App\Models\TranscriptionSegment;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class MoveTranscriptionSegmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Where the cited text should end up, as an offset in the text as it
     * stands now.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $segment = $this->route('segment');
        $length = $segment instanceof TranscriptionSegment
            ? mb_strlen($segment->transcriptionLayer->text)
            : 0;

        return [
            'target_offset' => ['required', 'integer', 'min:0', 'max:'.$length],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $segment = $this->route('segment');

            if (! $segment instanceof TranscriptionSegment) {
                return;
            }

            $target = (int) $this->input('target_offset');

            // Landing inside itself is not a move, and the arithmetic for it
            // has no meaning: the destination is expressed in a text that
            // still contains the words about to be lifted out of it.
            if ($target > $segment->start_offset && $target < $segment->end_offset) {
                $validator->errors()->add(
                    'target_offset',
                    'A passage cannot be moved into the middle of itself.',
                );
            }
        });
    }
}
