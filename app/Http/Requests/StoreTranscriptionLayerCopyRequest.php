<?php

namespace App\Http\Requests;

use App\Enums\TranscriptionLayer;
use App\Models\Transcription;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTranscriptionForkRequest extends FormRequest
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
     * Together `witness_id` and `layer` name the slot the copy fills — a
     * witness holds at most one transcription per layer. The source's own
     * witness is allowed: copying onto it is how the second layer of a
     * witness is started, in either direction (see
     * App\Enums\TranscriptionLayer).
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'witness_id' => ['required', Rule::exists('witnesses', 'id')],
            'layer' => ['required', Rule::enum(TranscriptionLayer::class)],
            'tags' => ['sometimes', 'array'],
            'tags.*' => ['string', 'max:50'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $occupied = Transcription::where('witness_id', $this->input('witness_id'))
                ->where('layer', $this->input('layer'))
                ->exists();

            // A witness holds one transcription per layer, so a copy fills an
            // empty slot rather than piling up beside what is already there.
            // Overwriting would take the target's citation spans, image
            // regions and collated readings with it, so it is refused rather
            // than confirmed: clear the slot deliberately if that is meant.
            if ($occupied) {
                $validator->errors()->add(
                    'layer',
                    'That witness already has a '.$this->input('layer').' transcription. Delete it first if you mean to replace it.',
                );
            }
        });
    }
}
