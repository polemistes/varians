<?php

namespace App\Http\Requests;

use App\Models\Lemma;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SelectEditionLemmaRequest extends FormRequest
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
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Lemma $lemma */
        $lemma = $this->route('lemma');

        return [
            'reading_id' => ['required', Rule::exists('lemma_readings', 'id')->where('lemma_id', $lemma->id)],
        ];
    }
}
