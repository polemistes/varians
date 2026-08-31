<?php

namespace App\Http\Requests;

use App\Enums\TranscriptionLayer;
use Illuminate\Contracts\Validation\ValidationRule;
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
     * `witness_id` may be the source's own witness: forking onto the same
     * witness is how a normalized layer is made from a diplomatic one (see
     * App\Enums\TranscriptionLayer). `layer` defaults to the source's own
     * when omitted, which keeps an ordinary cross-witness fork behaving
     * exactly as before.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'witness_id' => ['required', Rule::exists('witnesses', 'id')],
            'layer' => ['sometimes', Rule::enum(TranscriptionLayer::class)],
            'tags' => ['sometimes', 'array'],
            'tags.*' => ['string', 'max:50'],
        ];
    }
}
