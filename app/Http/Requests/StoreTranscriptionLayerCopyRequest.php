<?php

namespace App\Http\Requests;

use App\Models\Transcription;
use App\Models\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreTranscriptionLayerCopyRequest extends FormRequest
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
     * `transcription_id` names the destination, and the layer follows from
     * it: within the source's own transcription there is only the other layer
     * to copy into, and into a different transcription the copy goes to the
     * corresponding layer. Copying a diplomatic text into some other
     * manuscript's normalized layer is not a thing an editor means.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'transcription_id' => ['required', Rule::exists('transcriptions', 'id')],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $target = Transcription::whereKey($this->input('transcription_id'))->first();
            $source = $this->route('transcription');

            if ($target === null || ! $source instanceof TranscriptionLayer) {
                return;
            }

            $layer = $source->destinationLayerIn($target);
            $destination = $target->layers()->where('layer', $layer)->first();

            // Copying over text would take that layer's citation spans, image
            // regions and any collated readings with it. Refused rather than
            // confirmed: clear it deliberately if that is what is meant.
            if ($destination !== null && $destination->text !== '') {
                $validator->errors()->add(
                    'transcription_id',
                    'That transcription\'s '.$layer->value.' layer already has text. Clear it first if you mean to replace it.',
                );
            }
        });
    }
}
