<?php

namespace App\Http\Requests;

use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTranscriptionPageBreakRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var TranscriptionLayer $transcription */
        $transcription = $this->route('transcription');

        return $this->user()->can('update', $transcription);
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

        // A division names a page of THIS witness — a page of another
        // manuscript is nothing here, and the copier maps pages by witness.
        $witnessId = $transcription instanceof TranscriptionLayer ? $transcription->transcription->witness_id : 0;

        return [
            'manuscript_page_id' => ['required', Rule::exists('manuscript_pages', 'id')->where('witness_id', $witnessId)],
            // A break may sit at the very end: that is a page whose text has
            // not been transcribed yet, which is the normal state of the page
            // an editor is about to start on.
            'start_offset' => ['required', 'integer', 'min:0', 'max:'.$length],
        ];
    }
}
