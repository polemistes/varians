<?php

namespace App\Http\Requests;

use App\Models\Witness;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreManuscriptPageRequest extends FormRequest
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
     * A page is named and nothing more. Images arrive later, or never, and
     * where its text begins is recorded per layer as a page break.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'label' => ['required', 'string', 'max:50'],
        ];
    }
}
