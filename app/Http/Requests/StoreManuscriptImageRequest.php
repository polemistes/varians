<?php

namespace App\Http\Requests;

use App\Models\Witness;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreManuscriptImageRequest extends FormRequest
{
    /**
     * The policy decides — see App\Policies. Checked before validation, so
     * an unauthorized request learns nothing from the rules.
     */
    public function authorize(): bool
    {
        /** @var Witness $witness */
        $witness = $this->route('witness');

        return $this->user()->can('update', $witness);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'folio_label' => ['required', 'string', 'max:50'],
            'image' => ['required', 'image', 'max:20480'],
        ];
    }
}
