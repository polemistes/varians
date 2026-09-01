<?php

namespace App\Http\Requests;

use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTranscriptionPageBreakRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Where a page begins in this layer's text. One offset, not a range: the
     * page runs from here to wherever the next one starts.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $transcription = $this->route('transcription');
        $length = $transcription instanceof TranscriptionLayer ? mb_strlen($transcription->text) : 0;

        return [
            'manuscript_page_id' => ['required', Rule::exists('manuscript_pages', 'id')],
            // A break may sit at the very end: that is a page whose text has
            // not been transcribed yet, which is the normal state of the page
            // an editor is about to start on.
            'start_offset' => ['required', 'integer', 'min:0', 'max:'.$length],
        ];
    }
}
